import type {
  Ontology,
  EntityType,
  Property,
  Relationship,
  RelationshipAttribute,
  DataBinding,
} from '../../data/ontology';

export class RDFParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RDFParseError';
  }
}

// ---------------------------------------------------------------------------
// 命名空间：常量 + 归一化
// ---------------------------------------------------------------------------

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL_NS = 'http://www.w3.org/2002/07/owl#';

/**
 * 命名空间归一化：统一 https→http，并去掉结尾的 `#` / `/`。
 *
 * 这样旧式 owl 命名空间（`http://www.w3.org/2002/07/owl`，结尾无井号）
 * 会与标准写法 `http://www.w3.org/2002/07/owl#` 视为同一个命名空间 ——
 * 否则 `getElementsByTagNameNS` 一个元素都匹配不到，直接误报「找不到本体定义」。
 */
function normalizeNs(ns: string | null | undefined): string {
  if (!ns) return '';
  return ns.replace(/^https:/, 'http:').replace(/[#/]+$/, '');
}

const RDF_NS_NORM = normalizeNs(RDF_NS);
const RDFS_NS_NORM = normalizeNs(RDFS_NS);
const OWL_NS_NORM = normalizeNs(OWL_NS);

/** 元素的 local name（去掉命名空间前缀）。 */
function localNameOf(el: Element): string {
  return el.localName || el.tagName.split(':').pop() || el.tagName;
}

/** 元素是否属于某个（已归一化的）命名空间。 */
function inNs(el: Element, nsNorm: string): boolean {
  return normalizeNs(el.namespaceURI) === nsNorm;
}

/**
 * 深度优先遍历 root 及其全部后代（**含 root 自身**）。
 *
 * 必须自己写而不能用 `getElementsByTagNameNS`：后者只返回后代、不包含调用元素，
 * 于是「根元素就是 <owl:Ontology>」这类没有 <rdf:RDF> 包裹的文档会一个都找不到。
 */
function walk(root: Element, visit: (el: Element) => void): void {
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    visit(el);
    // 逆序压栈，保证访问顺序与文档顺序一致
    for (let i = el.children.length - 1; i >= 0; i--) {
      stack.push(el.children[i]);
    }
  }
}

/** 收集「local name + 命名空间」都匹配的全部元素，含 root 自身。 */
function collectByLocalName(root: Element, localName: string, nsNorm: string): Element[] {
  const out: Element[] = [];
  walk(root, (el) => {
    if (localNameOf(el) === localName && inNs(el, nsNorm)) out.push(el);
  });
  return out;
}

/**
 * Extract the local name (fragment) from a URI.
 * e.g., "http://example.org/ontology/foo/Customer" → "Customer"
 */
function localNameFromUri(uri: string): string {
  const hashIdx = uri.lastIndexOf('#');
  if (hashIdx >= 0) return uri.substring(hashIdx + 1);
  const slashIdx = uri.lastIndexOf('/');
  if (slashIdx >= 0) return uri.substring(slashIdx + 1);
  return uri;
}

/** 把 URI 拆成「归一化命名空间」+「local name」。 */
function splitUri(uri: string): { ns: string; local: string } {
  const local = localNameFromUri(uri);
  const ns = uri.length > local.length ? uri.substring(0, uri.length - local.length) : '';
  return { ns: normalizeNs(ns), local };
}

/** 元素的 rdf:type 目标 URI 列表。 */
function getTypeUris(el: Element): string[] {
  const out: string[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (localNameOf(child) !== 'type' || !inNs(child, RDF_NS_NORM)) continue;
    const res =
      child.getAttributeNS(RDF_NS, 'resource') ||
      child.getAttribute('rdf:resource') ||
      child.textContent?.trim() ||
      '';
    if (res) out.push(res);
  }
  return out;
}

/** 元素是否通过 rdf:type 声明自己属于 `nsNorm` 下的 `localName` 类型。 */
function hasType(el: Element, nsNorm: string, localName: string): boolean {
  return getTypeUris(el).some((uri) => {
    const { ns, local } = splitUri(uri);
    return ns === nsNorm && local === localName;
  });
}

/** 元素的 rdf:about / rdf:ID。 */
function getAbout(el: Element): string {
  return (
    el.getAttributeNS(RDF_NS, 'about') ||
    el.getAttribute('rdf:about') ||
    el.getAttributeNS(RDF_NS, 'ID') ||
    el.getAttribute('rdf:ID') ||
    ''
  );
}

/**
 * Get the text content of a child element by local name within a parent element.
 * Searches across common RDF/OWL namespaces.
 */
function getChildText(parent: Element, localName: string, namespace?: string): string | null {
  const nsNorm = namespace ? normalizeNs(namespace) : null;

  // 1) 直接子元素 + 命名空间匹配 —— RDF/XML 里 label / comment 基本都是直接子元素
  if (nsNorm) {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (localNameOf(child) === localName && inNs(child, nsNorm)) return child.textContent;
    }
  }

  // 2) 更深层的后代 + 命名空间匹配（兼容把描述嵌套在中间层的写法）
  if (nsNorm) {
    let found: string | null = null;
    walk(parent, (el) => {
      if (found !== null || el === parent) return;
      if (localNameOf(el) === localName && inNs(el, nsNorm)) found = el.textContent;
    });
    if (found !== null) return found;
  }

  // 3) 直接子元素按 local name 兜底（兼容没声明命名空间的私有词汇）
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (localNameOf(child) === localName) return child.textContent;
  }
  return null;
}

/**
 * Get the rdf:resource attribute from a child element.
 */
function getChildResource(parent: Element, localName: string): string | null {
  const readResource = (el: Element): string | null =>
    el.getAttributeNS(RDF_NS, 'resource') || el.getAttribute('rdf:resource');

  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (localNameOf(child) !== localName) continue;
    const res = readResource(child);
    if (res) return res;
  }

  let found: string | null = null;
  walk(parent, (el) => {
    if (found !== null || el === parent) return;
    if (localNameOf(el) !== localName) return;
    const res = readResource(el);
    if (res) found = res;
  });
  return found;
}

/**
 * Get all text values from children with a given local name.
 */
function getChildTexts(parent: Element, localName: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (localNameOf(child) === localName && child.textContent) {
      results.push(child.textContent);
    }
  }
  return results;
}

/**
 * Uncapitalize the first character.
 */
function uncapitalize(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

const VALID_PROPERTY_TYPES = ['string', 'integer', 'decimal', 'double', 'date', 'datetime', 'boolean', 'enum'] as const;
type PropertyType = (typeof VALID_PROPERTY_TYPES)[number];

function isValidPropertyType(t: string): t is PropertyType {
  return (VALID_PROPERTY_TYPES as readonly string[]).includes(t);
}

const XSD_TO_TYPE: Record<string, PropertyType> = {
  string: 'string',
  integer: 'integer',
  int: 'integer',
  long: 'integer',
  decimal: 'decimal',
  float: 'decimal',
  double: 'double',
  date: 'date',
  dateTime: 'datetime',
  boolean: 'boolean',
};

const VALID_CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const;
type Cardinality = (typeof VALID_CARDINALITIES)[number];

function isValidCardinality(c: string): c is Cardinality {
  return (VALID_CARDINALITIES as readonly string[]).includes(c);
}

interface ParsedDatatypeProperty {
  about: string;
  label: string;
  domainUri: string | null;
  rangeUri: string | null;
  comment: string | null;
  isIdentifier: boolean;
  unit: string | null;
  enumValues: string | null;
  propertyType: string | null;
  relationshipAttributeOf: string | null;
  attributeType: string | null;
}

// ---------------------------------------------------------------------------
// 宽容收集：同时支持「显式标签」与「rdf:Description + rdf:type」两种 RDF/XML 写法
// ---------------------------------------------------------------------------

/** 收集去重器。 */
function makeCollector(): { push: (el: Element) => void; list: Element[] } {
  const seen = new Set<Element>();
  const list: Element[] = [];
  return {
    list,
    push(el: Element) {
      if (seen.has(el)) return;
      seen.add(el);
      list.push(el);
    },
  };
}

/**
 * 收集本体元数据元素。支持：
 *   a) `<owl:Ontology rdf:about="…">`
 *   b) `<rdf:Description rdf:about="…"><rdf:type rdf:resource="…/owl#Ontology"/></rdf:Description>`
 *   c) 根元素直接是 `<owl:Ontology>`（没有 `<rdf:RDF>` 包裹）
 */
function collectOntologyElements(root: Element): Element[] {
  const { push, list } = makeCollector();
  for (const el of collectByLocalName(root, 'Ontology', OWL_NS_NORM)) push(el);
  walk(root, (el) => {
    if (hasType(el, OWL_NS_NORM, 'Ontology')) push(el);
  });
  return list;
}

/**
 * 收集类定义元素（→ 实体类型）。支持：
 *   a) `<owl:Class rdf:about="…">`
 *   b) `<rdfs:Class rdf:about="…">`（RDFS 本体）
 *   c) `<rdf:Description rdf:about="…"><rdf:type rdf:resource="…/owl#Class"/></rdf:Description>`
 *      —— 这是合法的 RDF/XML 简写，大量工具与数据库导出都用这种形式，
 *         旧版解析器只认 (a)，用户从外部导入时极易踩坑。
 */
function collectClassElements(root: Element): Element[] {
  const { push, list } = makeCollector();
  for (const el of collectByLocalName(root, 'Class', OWL_NS_NORM)) push(el);
  for (const el of collectByLocalName(root, 'Class', RDFS_NS_NORM)) push(el);
  walk(root, (el) => {
    if (hasType(el, OWL_NS_NORM, 'Class') || hasType(el, RDFS_NS_NORM, 'Class')) push(el);
  });
  return list;
}

/** 收集属性元素（DatatypeProperty / ObjectProperty / AnnotationProperty）。 */
function collectPropertyElements(root: Element, typeLocalName: string): Element[] {
  const { push, list } = makeCollector();
  for (const el of collectByLocalName(root, typeLocalName, OWL_NS_NORM)) push(el);
  walk(root, (el) => {
    if (hasType(el, OWL_NS_NORM, typeLocalName)) push(el);
  });
  return list;
}

/** 统计实例（NamedIndividual）数量 —— 只用于把报错说得更准确。 */
function countIndividuals(root: Element): number {
  const seen = new Set<Element>();
  walk(root, (el) => {
    if (localNameOf(el) === 'NamedIndividual' && inNs(el, OWL_NS_NORM)) {
      seen.add(el);
      return;
    }
    if (hasType(el, OWL_NS_NORM, 'NamedIndividual')) seen.add(el);
  });
  return seen.size;
}

// ---------------------------------------------------------------------------
// 格式体检：把「Malformed XML」翻译成用户能照着做的提示
// ---------------------------------------------------------------------------

function looksLikeJsonLd(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

/** 粗略识别 Turtle / N-Triples / TriG 等非 XML 的 RDF 序列化。 */
function looksLikeTurtle(text: string): boolean {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (/^@(prefix|base)\b/im.test(t)) return true; // Turtle / TriG 指令
  if (/^(PREFIX|BASE)\s/im.test(t)) return true; // SPARQL 风格前缀声明
  if (/^<[^<>\s]+>\s+<[^<>\s]+>\s+/m.test(t)) return true; // N-Triples 语句
  if (/\ba\s+owl:(Class|Ontology|ObjectProperty|DatatypeProperty|NamedIndividual)\b/.test(t)) return true;
  return false;
}

const TURTLE_HINT =
  '文件看起来是 Turtle / N-Triples 语法（含 @prefix 或 a owl:Class 这类写法），' +
  '本平台目前只支持 RDF/XML。请在 Protégé 里用「File → Save As → RDF/XML Syntax」' +
  '另存为 .rdf / .owl 后再导入，或用在线转换器把 .ttl 转成 RDF/XML。';

/**
 * Parse an RDF/XML (OWL) string into an Ontology and optional DataBindings.
 */
export function parseRDF(rdfXml: string): { ontology: Ontology; bindings: DataBinding[] } {
  // --- 先做格式体检：非 XML 的 RDF 序列化给出可操作提示，而不是崩在 DOMParser 上 ---
  if (looksLikeJsonLd(rdfXml)) {
    throw new RDFParseError(
      '文件是 JSON-LD 语法（以 { 或 [ 开头），本平台目前只支持 RDF/XML。' +
        '请在 Protégé 里用「File → Save As → RDF/XML Syntax」重新导出，' +
        '或先用在线工具把 .jsonld 转成 .rdf / .owl。',
    );
  }
  if (looksLikeTurtle(rdfXml)) {
    throw new RDFParseError(TURTLE_HINT);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(rdfXml, 'application/xml');

  // Check for XML parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    const detail = parseError.textContent?.replace(/\s+/g, ' ').trim() || 'parse error';
    throw new RDFParseError(
      `Malformed XML: ${detail}。文件不是合法的 RDF/XML，` +
        '请确认文件完整、编码正确（建议 UTF-8），或先用 Protégé 以 RDF/XML 格式重新导出。',
    );
  }

  const root = doc.documentElement;

  // --- Extract ontology metadata ---
  let ontologyName = '';
  let ontologyDescription = '';

  const ontologyEls = collectOntologyElements(root);
  if (ontologyEls.length > 0) {
    const ontEl = ontologyEls[0];
    ontologyName = getChildText(ontEl, 'label', RDFS_NS) || '';
    ontologyDescription = getChildText(ontEl, 'comment', RDFS_NS) || '';
  }

  // --- Extract OWL Classes → EntityTypes ---
  const classEls = collectClassElements(root);
  const entityMap = new Map<string, EntityType>();

  for (let i = 0; i < classEls.length; i++) {
    const el = classEls[i];
    const about = getAbout(el);
    if (!about) continue;

    const className = localNameFromUri(about);
    const entityId = uncapitalize(className);
    const label = getChildText(el, 'label', RDFS_NS) || className;
    const description = getChildText(el, 'comment', RDFS_NS) || '';
    const icon = getChildText(el, 'icon') || '📦';
    const color = getChildText(el, 'color') || '#0078D4';

    entityMap.set(about, {
      id: entityId,
      name: label,
      description,
      icon,
      color,
      properties: [],
    });
  }

  // --- Extract DatatypeProperties → Properties + Relationship Attributes ---
  const dtPropEls = collectPropertyElements(root, 'DatatypeProperty');
  const parsedDtProps: ParsedDatatypeProperty[] = [];

  for (let i = 0; i < dtPropEls.length; i++) {
    const el = dtPropEls[i];
    const about = getAbout(el);
    if (!about) continue;

    const comments = getChildTexts(el, 'comment');
    const hasIdentifierComment = comments.some(c => /^identifier\s+property$/i.test(c.trim()));
    const descriptionComment = comments.find(c => !/^identifier\s+property$/i.test(c.trim())) ?? null;

    parsedDtProps.push({
      about,
      label: getChildText(el, 'label', RDFS_NS) || localNameFromUri(about),
      domainUri: getChildResource(el, 'domain'),
      rangeUri: getChildResource(el, 'range'),
      comment: descriptionComment,
      isIdentifier: getChildText(el, 'isIdentifier') === 'true' || hasIdentifierComment,
      unit: getChildText(el, 'unit'),
      enumValues: getChildText(el, 'enumValues'),
      propertyType: getChildText(el, 'propertyType'),
      relationshipAttributeOf: getChildText(el, 'relationshipAttributeOf'),
      attributeType: getChildText(el, 'attributeType'),
    });
  }

  // Collect relationship attributes separately
  const relAttrMap = new Map<string, RelationshipAttribute[]>();

  for (const dtProp of parsedDtProps) {
    if (dtProp.relationshipAttributeOf) {
      const relId = dtProp.relationshipAttributeOf;
      if (!relAttrMap.has(relId)) {
        relAttrMap.set(relId, []);
      }
      relAttrMap.get(relId)!.push({
        name: dtProp.label,
        type: dtProp.attributeType || 'string',
      });
      continue;
    }

    // Regular entity property — match to entity by domain URI
    if (!dtProp.domainUri) continue;

    const entity = entityMap.get(dtProp.domainUri);
    if (!entity) continue;

    // Determine property type
    let propType: PropertyType = 'string';
    if (dtProp.propertyType && isValidPropertyType(dtProp.propertyType)) {
      propType = dtProp.propertyType;
    } else if (dtProp.rangeUri) {
      const xsdLocal = localNameFromUri(dtProp.rangeUri);
      if (XSD_TO_TYPE[xsdLocal]) {
        propType = XSD_TO_TYPE[xsdLocal];
      }
    }

    const prop: Property = {
      name: dtProp.label,
      type: propType,
    };

    if (dtProp.isIdentifier) prop.isIdentifier = true;
    if (dtProp.unit) prop.unit = dtProp.unit;
    if (dtProp.enumValues) {
      prop.values = dtProp.enumValues.split(',');
    }
    if (dtProp.comment) prop.description = dtProp.comment;

    entity.properties.push(prop);
  }

  // --- Extract ObjectProperties → Relationships ---
  const objPropEls = collectPropertyElements(root, 'ObjectProperty');
  const relationships: Relationship[] = [];

  for (let i = 0; i < objPropEls.length; i++) {
    const el = objPropEls[i];
    const about = getAbout(el);
    if (!about) continue;

    const relId = localNameFromUri(about);
    const label = getChildText(el, 'label', RDFS_NS) || relId;
    const description = getChildText(el, 'comment', RDFS_NS) || undefined;

    // Get from/to entity IDs — prefer explicit ont:fromEntityId/toEntityId,
    // fallback to domain/range URI.  Always uncapitalize to match entity IDs.
    let fromId = uncapitalize(getChildText(el, 'fromEntityId') || '');
    let toId = uncapitalize(getChildText(el, 'toEntityId') || '');

    if (!fromId) {
      const domainUri = getChildResource(el, 'domain');
      if (domainUri) fromId = uncapitalize(localNameFromUri(domainUri));
    }
    if (!toId) {
      const rangeUri = getChildResource(el, 'range');
      if (rangeUri) toId = uncapitalize(localNameFromUri(rangeUri));
    }

    const cardinalityStr = getChildText(el, 'cardinality') || 'one-to-many';
    const cardinality: Cardinality = isValidCardinality(cardinalityStr)
      ? cardinalityStr
      : 'one-to-many';

    const rel: Relationship = {
      id: relId,
      name: label,
      from: fromId,
      to: toId,
      cardinality,
    };

    if (description) rel.description = description;

    // Attach relationship attributes
    const attrs = relAttrMap.get(relId);
    if (attrs && attrs.length > 0) {
      rel.attributes = attrs;
    }

    // Skip relationships with unresolved source or target
    if (!rel.from || !rel.to) continue;

    relationships.push(rel);
  }

  // --- Extract DataBindings ---
  const bindings: DataBinding[] = [];
  // Look for ont:DataBinding elements (they use the ontology namespace)
  const allElements = root.getElementsByTagName('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    const localName = localNameOf(el);
    if (localName !== 'DataBinding') continue;

    const entityId = getChildText(el, 'boundEntityId') || '';
    const source = getChildText(el, 'source') || '';
    const table = getChildText(el, 'table') || '';
    const mappingTexts = getChildTexts(el, 'columnMapping');

    const columnMappings: Record<string, string> = {};
    for (const mapping of mappingTexts) {
      const eqIdx = mapping.indexOf('=');
      if (eqIdx > 0) {
        columnMappings[mapping.substring(0, eqIdx)] = mapping.substring(eqIdx + 1);
      }
    }

    if (entityId) {
      bindings.push({ entityTypeId: entityId, source, table, columnMappings });
    }
  }

  // --- Build the Ontology ---
  const entityTypes = Array.from(entityMap.values());

  if (!ontologyName && entityTypes.length === 0) {
    // 保留英文主句以兼容既有测试与日志检索，后面补上中文的可操作说明。
    const prefix = 'No ontology metadata or OWL classes found in the RDF document. ';
    const individualCount = countIndividuals(root);

    if (individualCount > 0) {
      throw new RDFParseError(
        prefix +
          `文件里只找到 ${individualCount} 个实例（NamedIndividual），没有任何类定义（owl:Class / rdfs:Class）。` +
          '这看起来是「实例数据」而不是「本体定义」——请导入本体文件；若只想查看数据，' +
          '可用顶栏的「接入数据源」加载这份数据。',
      );
    }

    throw new RDFParseError(
      prefix +
        '未在文件中找到任何本体定义。当前支持两种 RDF/XML 写法：' +
        '① <owl:Class rdf:about="…">；' +
        '② <rdf:Description rdf:about="…"><rdf:type rdf:resource="…/owl#Class"/></rdf:Description>。' +
        '若文件是 Turtle（.ttl）或 JSON-LD（.jsonld），请先转成 RDF/XML 再导入。',
    );
  }

  const ontology: Ontology = {
    name: ontologyName || 'Imported Ontology',
    description: ontologyDescription,
    entityTypes,
    relationships,
  };

  return { ontology, bindings };
}
