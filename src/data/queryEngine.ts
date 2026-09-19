import type { Ontology } from './ontology';

export interface QueryHit {
  type: 'entity' | 'relationship' | 'property' | 'schema';
  id: string;
  label: string;
  detail: string;
}

export interface QueryResponse {
  query: string;
  result: string;
  hits: QueryHit[];
  highlightEntities: string[];
  highlightRelationships: string[];
  interpretation?: string;
}

/** 实体 id 的兜底同义词表（ontology 没声明 synonyms 时使用）。 */
const ENTITY_ALIASES: Record<string, string[]> = {
  customer: ['客户', '会员', '顾客', '买家'],
  order: ['订单', '购物', '交易', '购买', '下单', '买单'],
  product: ['商品', '产品', '咖啡', '饮品', '咖啡豆'],
  store: ['门店', '店铺', '咖啡馆', '店面', '分店'],
  shipment: ['货运', '物流', '配送', '运输', '发货'],
  supplier: ['供应商', '供货商', '厂商', '供货'],
};

/** 关系 id 的兜底同义词表（key = 关系 id）。 */
const RELATIONSHIP_ALIASES: Record<string, string[]> = {
  customer_places_order: ['下单', '购买', '买家下单', '客户订单'],
  order_contains_product: ['包含', '明细', '订单明细', '行项目'],
  order_processed_at_store: ['门店处理', '店铺', '在哪家店', '出单门店'],
  product_sourced_from_supplier: ['采购', '采购自', '供货'],
  shipment_from_supplier: ['发出', '发货方', '谁发的'],
  shipment_to_store: ['送达', '收件门店', '运到'],
  shipment_contains_product: ['装载', '货物'],
};

/** 取出实体的所有可匹配字符串（name / id / synonyms）。 */
function entityHaystacks(entity: Ontology['entityTypes'][number]): string[] {
  const set = entity.synonyms ?? ENTITY_ALIASES[entity.id] ?? [];
  return [entity.name, entity.id, ...set];
}

/** 取出关系的可匹配字符串。 */
function relationshipHaystacks(rel: Ontology['relationships'][number]): string[] {
  const set = RELATIONSHIP_ALIASES[rel.id] ?? [];
  return [rel.name, rel.id, ...set];
}

/** 把任意字符串切成 token：英文按词、中文按单字 + 二元窗，并过滤停用词。 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const cleaned = text.toLowerCase().trim();
  const tokens = new Set<string>();
  for (const m of cleaned.match(/[a-z0-9_]+/g) ?? []) {
    if (m.length >= 1) tokens.add(m);
  }
  for (const seg of cleaned.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (let i = 0; i < seg.length; i++) tokens.add(seg[i]);
    for (let i = 0; i < seg.length - 1; tokens.add(seg.slice(i, i + 2)), i++);
  }
  const stopwords = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were',
    'what', 'which', 'who', 'how', 'when', 'where', 'why',
    '的', '了', '是', '在', '和', '与', '有', '我', '你', '他', '她', '它', '们',
    '请', '帮', '查', '看', '一下', '这个', '那个',
  ]);
  for (const sw of stopwords) tokens.delete(sw);
  return [...tokens];
}

/**
 * 中英术语桥（key = 中文说法，value = 英文写法的小写别名）。
 *
 * 为什么需要：内置样本数据集（Fourth Coffee）的列名与列值都是英文
 * （`loyalty_status: Platinum`、`status: Delayed`、`certification: Fair Trade`），
 * 而用户习惯用中文提问。仅靠 token 重合度打分会让「中文提问 × 英文数据」
 * 全部 0 分——在「无命中即不注入」的新规则下会导致召回永远为空。
 * 这里把问题里出现的中文术语补上英文写法，让跨语言也能召回。
 */
const CROSS_LINGUAL_TERMS: Record<string, string[]> = {
  // 会员等级
  '铂金': ['platinum'],
  '白金': ['platinum'],
  '黄金': ['gold'],
  '白银': ['silver'],
  '青铜': ['bronze'],
  // 订单状态
  '待处理': ['pending'],
  '准备中': ['preparing'],
  '制作中': ['preparing'],
  '已就绪': ['ready'],
  '就绪': ['ready'],
  '已完成': ['completed'],
  '已取消': ['cancelled'],
  '取消': ['cancelled'],
  // 货运状态
  '在途': ['in transit', 'transit'],
  '运输中': ['in transit'],
  '延迟': ['delayed'],
  '延误': ['delayed'],
  '已送达': ['delivered'],
  // 支付方式
  '现金': ['cash'],
  '银行卡': ['card'],
  '信用卡': ['card'],
  '移动支付': ['mobile'],
  '礼品卡': ['gift card'],
  // 可持续认证
  '有机': ['organic'],
  '公平贸易': ['fair trade'],
  '雨林联盟': ['rainforest alliance'],
  '直接贸易': ['direct trade'],
  '无认证': ['none'],
  // 产地 / 国家
  '埃塞俄比亚': ['ethiopia', 'ethiopian'],
  '哥伦比亚': ['colombia', 'colombian'],
  '肯尼亚': ['kenya'],
  '印度尼西亚': ['indonesia'],
  '苏门答腊': ['sumatra'],
  '哥斯达黎加': ['costa rica'],
  '危地马拉': ['guatemala'],
  '中国': ['china'],
  '法国': ['france'],
  '日本': ['japan'],
  // 通用字段概念
  '城市': ['city'],
  '认证': ['certification'],
  '产地': ['origin'],
  '等级': ['tier'],
  '状态': ['status'],
  '金额': ['total', 'price'],
  '重量': ['weight'],
  '容量': ['capacity'],
  '邮箱': ['email'],
  '评分': ['rating'],
  '门店': ['store'],
  '供应商': ['supplier'],
  '客户': ['customer'],
  '顾客': ['customer'],
  '会员': ['customer', 'loyalty'],
  '订单': ['order'],
  '商品': ['product'],
  '产品': ['product'],
  '货运': ['shipment'],
  '物流': ['shipment'],
  '配送': ['shipment'],
};

/** 把问题里出现的中文术语补上英文别名（只做加法，不改动原 token）。 */
export function expandCrossLingualTokens(question: string, tokens: string[]): string[] {
  const q = (question ?? '').toLowerCase();
  if (!q) return tokens;
  const out = new Set(tokens);
  for (const [zh, aliases] of Object.entries(CROSS_LINGUAL_TERMS)) {
    if (!q.includes(zh)) continue;
    for (const alias of aliases) {
      out.add(alias);
      // 多词别名拆成单词，便于与 "gift card" / "in transit" 这类列值部分匹配
      if (alias.includes(' ')) {
        for (const part of alias.split(/\s+/)) if (part) out.add(part);
      }
    }
  }
  return [...out];
}

/** 单次相关度：在 haystack 里找到几个 query token；找到越多分越高。 */
function tokenOverlapScore(haystack: string, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const h = haystack.toLowerCase();
  let matched = 0;
  for (const tok of tokens) {
    if (tok.length >= 1 && h.includes(tok)) matched += 1;
  }
  if (matched === 0) return 0;
  return Math.round((matched / tokens.length) * 100);
}

/** 在一组 haystack 里挑得分最高的。 */
function bestHaystackMatch(
  tokens: string[],
  haystacks: string[],
): { score: number; matched: string } {
  if (tokens.length === 0 || haystacks.length === 0) return { score: 0, matched: '' };
  let best = { score: 0, matched: '' };
  for (const h of haystacks) {
    const s = tokenOverlapScore(h, tokens);
    if (s > best.score) best = { score: s, matched: h };
  }
  return best;
}

function stripLeadingArticle(text: string): string {
  return text.replace(/^(a|an|the|一个|一种|这个|那个)\s+/i, '').trim();
}

function singularize(text: string): string {
  return text.endsWith('s') && !text.endsWith('ss') ? text.slice(0, -1) : text;
}

// Generate dynamic query suggestions based on the current ontology
export function generateQuerySuggestions(ontology: Ontology): string[] {
  const suggestions: string[] = [];
  const entities = ontology.entityTypes;
  const relationships = ontology.relationships;

  if (entities.length > 0) {
    const firstEntity = entities[0];
    suggestions.push(`什么是 ${firstEntity.name}？`);
    if (entities.length > 1) {
      const secondEntity = entities[1];
      suggestions.push(`什么是 ${secondEntity.name}？`);
    }
  }

  if (relationships.length > 0) {
    const rel = relationships[0];
    const fromEntity = entities.find((e) => e.id === rel.from);
    const toEntity = entities.find((e) => e.id === rel.to);
    if (fromEntity && toEntity) {
      suggestions.push(`${fromEntity.name} 如何关联到 ${toEntity.name}？`);
    }
  }

  suggestions.push('展示整个本体结构');
  suggestions.push('这个本体有哪些实体类型？');

  return [...new Set(suggestions)].slice(0, 6);
}

/**
 * Run a real retrieval over the ontology: rank entities / relationships /
 * properties by relevance to the query, and return a structured answer.
 *
 * The function intentionally does NOT generate demo/canned responses — every
 * line in the output is derived from the currently loaded Ontology.
 */
export function processQuery(query: string, ontology: Ontology): QueryResponse {
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedNoPunctuation = normalizedQuery.replace(/[?!.,;！？。；：…—\-~]+/g, '').trim();
  const entities = ontology.entityTypes;
  const relationships = ontology.relationships;

  if (!normalizedQuery) {
    return {
      query,
      result: '请输入要查询的问题。',
      hits: [],
      highlightEntities: [],
      highlightRelationships: [],
      interpretation: undefined,
    };
  }

  const entityMatches: { entity: typeof entities[number]; score: number }[] = [];
  const relMatches: { rel: typeof relationships[number]; score: number }[] = [];
  const hits: QueryHit[] = [];
  const tokens = tokenize(normalizedNoPunctuation);

  // --- Score entities (name / id / synonyms / description / properties) ---
  for (const entity of entities) {
    const nameMatch = bestHaystackMatch(tokens, entityHaystacks(entity));
    const nameScore = nameMatch.score;

    const descScore = entity.description
      ? Math.round(tokenOverlapScore(entity.description, tokens) * 0.6)
      : 0;

    let propScore = 0;
    for (const prop of entity.properties) {
      propScore = Math.max(propScore, Math.round(tokenOverlapScore(prop.name, tokens) * 0.8));
    }

    const total = Math.max(nameScore, descScore, propScore);
    if (total > 0) {
      entityMatches.push({ entity, score: total });
      hits.push({
        type: 'entity',
        id: entity.id,
        label: `${entity.icon} ${entity.name}`,
        detail: `${entity.properties.length} 个属性 · ${entity.description || ''}`,
      });
    }
  }

  // --- Score relationships ---
  for (const rel of relationships) {
    const nameMatch = bestHaystackMatch(tokens, relationshipHaystacks(rel));
    const nameScore = nameMatch.score;
    const descScore = rel.description
      ? Math.round(tokenOverlapScore(rel.description, tokens) * 0.6)
      : 0;
    const total = Math.max(nameScore, descScore);
    if (total > 0) {
      relMatches.push({ rel, score: total });
      hits.push({
        type: 'relationship',
        id: rel.id,
        label: rel.name,
        detail: `${rel.from} → ${rel.to}（${rel.cardinality}）`,
      });
    }
  }

  // Sort by score desc
  entityMatches.sort((a, b) => b.score - a.score);
  relMatches.sort((a, b) => b.score - a.score);

  // --- Schema overview queries ---
  if (
    normalizedNoPunctuation.includes('本体结构') ||
    normalizedNoPunctuation.includes('schema') ||
    normalizedNoPunctuation.includes('overview') ||
    (normalizedNoPunctuation.includes('实体') && normalizedNoPunctuation.includes('关系'))
  ) {
    const lines: string[] = [];
    lines.push(`**${ontology.name}** 本体概览`);
    lines.push(`共 ${entities.length} 个实体类型，${relationships.length} 条关系。`);
    lines.push('');
    lines.push('**实体类型：**');
    for (const entity of entities) {
      lines.push(`- ${entity.icon} **${entity.name}** · ${entity.properties.length} 个属性`);
    }
    if (relationships.length > 0) {
      lines.push('');
      lines.push('**关系：**');
      for (const rel of relationships.slice(0, 12)) {
        lines.push(`- ${rel.name}（${rel.from} → ${rel.to}，${rel.cardinality}）`);
      }
      if (relationships.length > 12) {
        lines.push(`- …还有 ${relationships.length - 12} 条`);
      }
    }
    return {
      query,
      result: lines.join('\n'),
      hits: [
        ...entities.map((e) => ({ type: 'entity' as const, id: e.id, label: e.name, detail: '' })),
        ...relationships.map((r) => ({ type: 'relationship' as const, id: r.id, label: r.name, detail: '' })),
      ],
      highlightEntities: entities.map((e) => e.id),
      highlightRelationships: relationships.map((r) => r.id),
      interpretation: `已识别为本体概览请求，加亮全部 ${entities.length} 个实体与 ${relationships.length} 条关系`,
    };
  }

  // --- "What is X" / "什么是 X" entity definition ---
  if (
    normalizedNoPunctuation.startsWith('what is ') ||
    normalizedNoPunctuation.startsWith('什么是 ') ||
    normalizedNoPunctuation.startsWith('what are ') ||
    normalizedNoPunctuation.startsWith('有哪些')
  ) {
    const prefixMatch =
      normalizedNoPunctuation.match(/^what\s+is\s+(.+)$/i) ||
      normalizedNoPunctuation.match(/^什么是\s*(.+)$/) ||
      normalizedNoPunctuation.match(/^what\s+are\s+(.+)$/i) ||
      normalizedNoPunctuation.match(/^有哪些\s*(.+)$/);
    if (prefixMatch) {
      const subject = stripLeadingArticle(prefixMatch[1]);
      const subjSingular = singularize(subject);

      // First try an exact entity match
      const exactEntity = entities.find((e) => {
        const n = e.name.toLowerCase();
        return subject === n || subjSingular === n || e.id.toLowerCase() === subject;
      });
      if (exactEntity) {
        return buildEntityDefinition(exactEntity, ontology, query, subject);
      }

      // Otherwise pick the highest-scoring entity
      if (entityMatches.length > 0 && entityMatches[0].score >= 30) {
        return buildEntityDefinition(entityMatches[0].entity, ontology, query, subject);
      }
    }
  }

  // --- "How does X connect to Y" relationship path query ---
  const connectMatch =
    normalizedNoPunctuation.match(/(.+?)\s*(如何|怎么)?\s*关联\s*(?:到|到|至)?\s*(.+)$/) ||
    normalizedNoPunctuation.match(/how\s+does\s+(.+?)\s+connect\s+(?:to|with)\s+(.+?)$/i);
  if (connectMatch) {
    const fromSubject = stripLeadingArticle(connectMatch[1]);
    const toSubject = stripLeadingArticle(connectMatch[connectMatch.length - 1]);
    const fromEntity = findEntityByName(entities, fromSubject);
    const toEntity = findEntityByName(entities, toSubject);

    if (fromEntity && toEntity) {
      const directRels = relationships.filter(
        (r) =>
          (r.from === fromEntity.id && r.to === toEntity.id) ||
          (r.from === toEntity.id && r.to === fromEntity.id)
      );
      const lines: string[] = [];
      lines.push(`**${fromEntity.name}** 与 **${toEntity.name}** 之间的关系：`);
      if (directRels.length === 0) {
        lines.push('');
        lines.push('未找到直接关系。可以尝试通过其他实体类型中转。');
      } else {
        for (const r of directRels) {
          const dir = r.from === fromEntity.id ? '→' : '←';
          lines.push(`- **${r.name}** ${dir}（${r.cardinality}）${r.description ? `— ${r.description}` : ''}`);
        }
      }
      return {
        query,
        result: lines.join('\n'),
        hits: [
          { type: 'entity', id: fromEntity.id, label: fromEntity.name, detail: '' },
          { type: 'entity', id: toEntity.id, label: toEntity.name, detail: '' },
          ...directRels.map((r) => ({ type: 'relationship' as const, id: r.id, label: r.name, detail: '' })),
        ],
        highlightEntities: [fromEntity.id, toEntity.id],
        highlightRelationships: directRels.map((r) => r.id),
        interpretation: `已识别为两实体关联查询：${fromEntity.name} ↔ ${toEntity.name}`,
      };
    }
  }

  // --- Count entities query ---
  if (normalizedNoPunctuation.includes('多少') || normalizedNoPunctuation.includes('how many')) {
    if (entityMatches.length > 0) {
      const top = entityMatches[0].entity;
      return {
        query,
        result: `本体共定义了 **${entities.length}** 个实体类型。其中与你查询最相关的是 **${top.name}**（共 ${top.properties.length} 个属性）。`,
        hits: [{ type: 'entity', id: top.id, label: top.name, detail: '' }],
        highlightEntities: [top.id],
        highlightRelationships: [],
        interpretation: `检测到数量查询，匹配实体：${top.name}`,
      };
    }
  }

  // --- Fallback: rank & summarize matches ---
  if (entityMatches.length > 0 || relMatches.length > 0) {
    const lines: string[] = [];
    lines.push(`针对 "${query}" 的检索结果（共 ${entityMatches.length} 个实体、${relMatches.length} 条关系命中）：`);
    lines.push('');
    if (entityMatches.length > 0) {
      lines.push('**匹配的实体类型：**');
      for (const m of entityMatches.slice(0, 5)) {
        lines.push(`- ${m.entity.icon} **${m.entity.name}** · 匹配度 ${m.score} · ${m.entity.properties.length} 个属性`);
      }
      if (entityMatches.length > 5) lines.push(`- …还有 ${entityMatches.length - 5} 个`);
      lines.push('');
    }
    if (relMatches.length > 0) {
      lines.push('**匹配的关系：**');
      for (const m of relMatches.slice(0, 5)) {
        lines.push(`- **${m.rel.name}** · 匹配度 ${m.score} · ${m.rel.from} → ${m.rel.to}`);
      }
      if (relMatches.length > 5) lines.push(`- …还有 ${relMatches.length - 5} 条`);
    }
    return {
      query,
      result: lines.join('\n'),
      hits,
      highlightEntities: entityMatches.slice(0, 6).map((m) => m.entity.id),
      highlightRelationships: relMatches.slice(0, 6).map((m) => m.rel.id),
      interpretation: `对 ${entityMatches.length} 个实体、${relMatches.length} 条关系做了相关度排序`,
    };
  }

  // No match — suggest what is in the ontology
  const suggestions = generateQuerySuggestions(ontology).slice(0, 3);
  return {
    query,
    result: `没有在本体 **${ontology.name}** 中找到与 "${query}" 直接相关的内容。\n\n可以试试：\n${suggestions.map((s) => `- "${s}"`).join('\n')}\n\n或者在右侧搜索框按名称检索。`,
    hits: [],
    highlightEntities: [],
    highlightRelationships: [],
    interpretation: undefined,
  };
}

function buildEntityDefinition(
  entity: Ontology['entityTypes'][number],
  ontology: Ontology,
  query: string,
  subject: string
): QueryResponse {
  const lines: string[] = [];
  lines.push(`**${entity.name}** ${entity.icon}`);
  if (entity.description) lines.push(entity.description);
  lines.push('');

  const outgoing = ontology.relationships.filter((r) => r.from === entity.id);
  const incoming = ontology.relationships.filter((r) => r.to === entity.id);

  if (entity.properties.length > 0) {
    lines.push(`**属性（${entity.properties.length}）：**`);
    for (const p of entity.properties) {
      const id = p.isIdentifier ? ' 🔑' : '';
      const unit = p.unit ? `（${p.unit}）` : '';
      lines.push(`- **${p.name}** · ${p.type}${unit}${id}`);
      if (p.description) lines.push(`  - ${p.description}`);
    }
    lines.push('');
  }

  if (outgoing.length > 0) {
    lines.push(`**指向其他实体（${outgoing.length}）：**`);
    for (const r of outgoing) {
      const other = ontology.entityTypes.find((e) => e.id === r.to);
      lines.push(`- ${r.name} → ${other?.icon ?? ''} ${other?.name ?? r.to}（${r.cardinality}）`);
    }
    lines.push('');
  }
  if (incoming.length > 0) {
    lines.push(`**被其他实体引用（${incoming.length}）：**`);
    for (const r of incoming) {
      const other = ontology.entityTypes.find((e) => e.id === r.from);
      lines.push(`- ${other?.icon ?? ''} ${other?.name ?? r.from} → ${r.name}（${r.cardinality}）`);
    }
  }

  return {
    query,
    result: lines.join('\n'),
    hits: [{ type: 'entity', id: entity.id, label: entity.name, detail: entity.description ?? '' }],
    highlightEntities: [entity.id],
    highlightRelationships: [...outgoing, ...incoming].map((r) => r.id),
    interpretation: `检测到实体定义查询，匹配：${entity.name}（主体：${subject}）`,
  };
}

function findEntityByName(
  entities: Ontology['entityTypes'],
  subject: string
): Ontology['entityTypes'][number] | null {
  const subj = subject.toLowerCase().trim();
  // 1) 精确匹配 name / id / 任意同义词
  for (const e of entities) {
    if (e.name.toLowerCase() === subj) return e;
    if (e.id.toLowerCase() === subj) return e;
    const syns = e.synonyms ?? ENTITY_ALIASES[e.id] ?? [];
    for (const s of syns) {
      if (s.toLowerCase() === subj) return e;
    }
  }
  // 2) 包含匹配（name / id / 同义词任一）
  for (const e of entities) {
    if (e.name.toLowerCase().includes(subj) || subj.includes(e.name.toLowerCase())) return e;
    const syns = e.synonyms ?? ENTITY_ALIASES[e.id] ?? [];
    for (const s of syns) {
      const sl = s.toLowerCase();
      if (sl.includes(subj) || subj.includes(sl)) return e;
    }
  }
  return null;
}

// ── 按问题相关性筛选数据行 ─────────────────────────────────────────────────

export interface SelectRelevantRowsOptions {
  /** 单行最大字符上限，超长截断，避免单个 cell 撑爆上下文。 */
  maxCellChars?: number;
}

/**
 * 把一份数据行按问题相关性排序，并截取前 topN 行（topN 是唯一上限）。
 *
 * 打分维度：
 *  - 问题 token 与列名（源列名 + 本体映射名）重合：+3 / 每 token
 *  - 问题 token 与单元格值（已转字符串）重合：+1 / 每 token
 *  （不再有「被映射的列」兜底加分——那会让每一行都得正分，永远「有命中」。）
 *
 * 行为（**无下限**）：
 *  - 有命中：按分数降序取前 topN 行；
 *  - 无命中（问题 token 为空 / 所有行 0 分）：返回**空数组** —— 不注入任何行。
 *    这是刻意设计：宁可不给数据，也不用无关行把上下文稀释成噪声。
 *
 * topN 由调用方决定，通常给一个较大的值（详见 `DEFAULT_ROWS_PER_DATASET`），
 * 让「命中多少就给多少」，上限只用于兜底防止上下文被单表撑爆。
 */
export function selectRelevantRows(
  rows: Record<string, unknown>[],
  question: string,
  columnMappings: Record<string, string> | undefined,
  topN: number,
  options: SelectRelevantRowsOptions = {},
): Record<string, unknown>[] {
  const { maxCellChars = 200 } = options;
  if (rows.length === 0 || topN <= 0) return [];
  const tokens = expandCrossLingualTokens(question, tokenize(question));
  // 没有问题 token（空问题 / 纯停用词且无已知术语）→ 无从判断相关性，不注入任何行。
  if (tokens.length === 0) return [];

  // 截断单 cell，防止一个长文本把所有分数都吃掉
  const trimmedRows = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const s = formatCellValue(v);
      out[k] = s.length > maxCellChars ? `${s.slice(0, maxCellChars)}…` : s;
    }
    return out;
  });

  const scored = trimmedRows.map((row, idx) => {
    let score = 0;
    for (const [key, value] of Object.entries(row)) {
      const rawKey = key.toLowerCase();
      const mappedKey = (columnMappings?.[key] ?? '').toLowerCase();
      const cellStr = typeof value === 'string' ? value.toLowerCase() : '';
      for (const tok of tokens) {
        if (rawKey.includes(tok) || mappedKey.includes(tok)) {
          score += 3;
        } else if (cellStr.includes(tok)) {
          score += 1;
        }
      }
    }
    // 同分时按原始顺序，保证稳定
    return { row, idx, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });

  const relevant = scored.filter((s) => s.score > 0);
  // 无命中 → 返回空数组（不补齐、不兜底）。命中多少给多少，上限为 topN。
  return relevant.slice(0, topN).map((s) => s.row);
}

/** 内部小工具：把任意单元格值转字符串（与 datasetFetcher.formatCell 对齐）。 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if ('value' in rec) return formatCellValue(rec.value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}