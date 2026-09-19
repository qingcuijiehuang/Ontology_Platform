import { Sparkles } from 'lucide-react';

export function AppFooter() {
  const deployedCommitSha = import.meta.env.VITE_DEPLOYED_COMMIT_SHA;
  const deployedRepo = import.meta.env.VITE_REPOSITORY;
  const shortCommit = deployedCommitSha ? deployedCommitSha.slice(0, 7) : null;
  const commitUrl = deployedCommitSha && deployedRepo
    ? `https://github.com/${deployedRepo}/commit/${deployedCommitSha}`
    : null;

  return (
    <footer className="app-footer">
      <a href="https://github.com/features/copilot" target="_blank" rel="noopener noreferrer">
        <Sparkles size={14} />
        基于 GitHub Copilot 构建
      </a>
      <span className="app-footer-sep">&middot;</span>
      <span>本体平台 · 接入真实 RDF / 数据库</span>
      {shortCommit && (
        <>
          <span className="app-footer-sep">&middot;</span>
          {commitUrl ? (
            <a href={commitUrl} target="_blank" rel="noopener noreferrer" title={deployedCommitSha}>
              部署版本 {shortCommit}
            </a>
          ) : (
            <span title={deployedCommitSha}>部署版本 {shortCommit}</span>
          )}
        </>
      )}
    </footer>
  );
}
