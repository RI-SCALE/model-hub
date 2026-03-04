import React, { useState, useEffect, useCallback } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArtifactInfo } from '../types/artifact';

const SERVER_URL = 'https://hypha.aicell.io';

// ── Small helpers ─────────────────────────────────────────────────────────────

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${copied ? 'bg-green-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
};

const CodeBlock: React.FC<{ code: string }> = ({ code }) => (
  <div className="relative group">
    <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
      {code}
    </pre>
    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <CopyButton text={code} />
    </div>
  </div>
);

// ── Git info box ──────────────────────────────────────────────────────────────

interface GitBoxProps {
  artifact: ArtifactInfo;
  server: any;
}

const GitInfoBox: React.FC<GitBoxProps> = ({ artifact, server }) => {
  const [gitAuthUrl, setGitAuthUrl] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [tokenExpiry, setTokenExpiry] = useState('');
  const [showBox, setShowBox] = useState(true);

  const gitUrl = (artifact as any).git_url;
  const alias = artifact.alias || artifact.id.split('/').pop() || '';
  const publicGitUrl = gitUrl || `${SERVER_URL}/ri-scale/artifacts/${alias}/git`;

  if (!gitUrl) return null; // Only show for git-storage artifacts

  const expiryOptions = [
    { label: '1 hour', seconds: 3600 },
    { label: '24 hours', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: '30 days', seconds: 2592000 },
  ];

  const generateAuthUrl = async (expiresIn: number, label: string) => {
    if (!server) return;
    setGeneratingToken(true);
    try {
      const token = await server.generateToken({ expires_in: expiresIn });
      const url = new URL(publicGitUrl);
      url.username = 'git';
      url.password = token;
      setGitAuthUrl(url.toString());
      setTokenExpiry(label);
    } catch (err: any) {
      alert('Failed to generate token: ' + err.message);
    } finally {
      setGeneratingToken(false);
    }
  };

  const pushCommands = gitAuthUrl
    ? `# Clone (or pull latest changes)\ngit clone ${gitAuthUrl} ${alias}\ncd ${alias}\n\n# Set up Git LFS for large files\ngit lfs install\ngit lfs track "*.pt" "*.ckpt" "*.h5" "*.pkl" "*.pth" "*.safetensors" "*.bin"\ngit add .gitattributes\n\n# Add / update your model files\ngit add .\ngit commit -m "Update model"\ngit push origin main`
    : `# Clone (read-only)\ngit clone ${publicGitUrl} ${alias}\ncd ${alias}`;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl overflow-hidden mb-6">
      <button
        onClick={() => setShowBox(!showBox)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-blue-100 transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold text-blue-800">
          <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.6 10.59L8.38 4.8l1.69 1.7c-.24.85.15 1.78.93 2.23v5.54c-.6.34-1 .99-1 1.73a2 2 0 0 0 2 2 2 2 0 0 0 2-2c0-.74-.4-1.39-1-1.73V9.41l2.07 2.09c-.07.15-.07.32-.07.5a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0-2-2c-.2 0-.37.04-.54.1L11.08 6.98c.2-.87-.17-1.8-.98-2.23a2 2 0 0 0-2.74.76 2 2 0 0 0 .23 2.34L5.92 9.72l-1.7-1.7-1.62 2.57z"/>
          </svg>
          Update this model via Git
        </span>
        <svg className={`w-4 h-4 text-blue-500 transition-transform ${showBox ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showBox && (
        <div className="px-5 pb-5 space-y-4">
          {/* Public URL */}
          <div>
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">Public clone URL (read-only)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-blue-200 rounded px-3 py-2 text-sm font-mono text-gray-700 truncate">{publicGitUrl}</code>
              <CopyButton text={publicGitUrl} />
            </div>
          </div>

          {/* Token generation */}
          <div>
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">Authenticated URL (read + push)</p>
            {!gitAuthUrl ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-blue-600">Generate a push token:</span>
                {expiryOptions.map(opt => (
                  <button
                    key={opt.label}
                    onClick={() => generateAuthUrl(opt.seconds, opt.label)}
                    disabled={generatingToken}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm rounded-lg font-medium transition-colors"
                  >
                    {generatingToken ? '…' : `${opt.label} token`}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-start gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <svg className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-xs text-yellow-700 flex-1">Token valid for {tokenExpiry}. Keep private.</span>
                  <button onClick={() => setGitAuthUrl(null)} className="text-xs text-yellow-700 underline">Clear</button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-blue-200 rounded px-3 py-2 text-sm font-mono text-gray-700 truncate">{gitAuthUrl}</code>
                  <CopyButton text={gitAuthUrl} />
                </div>
              </div>
            )}
          </div>

          {/* Commands */}
          <div>
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1.5">Git commands</p>
            <CodeBlock code={pushCommands} />
          </div>
        </div>
      )}
    </div>
  );
};

// ── File list ─────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const fileIcon = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['pt', 'pth', 'ckpt', 'h5', 'pkl', 'safetensors', 'bin'].includes(ext))
    return <span title="Model weights" className="text-purple-500">⚙</span>;
  if (['md', 'txt', 'rst'].includes(ext))
    return <span title="Documentation" className="text-blue-500">📄</span>;
  if (['yaml', 'yml', 'json', 'toml'].includes(ext))
    return <span title="Config" className="text-orange-500">⚙</span>;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext))
    return <span title="Image" className="text-green-500">🖼</span>;
  if (['py', 'js', 'ts', 'sh'].includes(ext))
    return <span title="Script" className="text-yellow-600">📝</span>;
  return <span className="text-gray-400">📄</span>;
};

// ── Main component ────────────────────────────────────────────────────────────

const Edit: React.FC = () => {
  const { artifactId } = useParams<{ artifactId: string }>();
  const navigate = useNavigate();
  const { artifactManager, isLoggedIn, server } = useHyphaStore();

  const [artifact, setArtifact] = useState<ArtifactInfo | null>(null);
  const [fileList, setFileList] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fullArtifactId = artifactId?.includes('/')
    ? artifactId
    : `ri-scale/${artifactId}`;

  const loadArtifact = useCallback(async () => {
    if (!artifactManager || !artifactId) return;
    setLoading(true);
    setError(null);
    try {
      const info = await artifactManager.read({ artifact_id: fullArtifactId });
      setArtifact(info);
    } catch (err: any) {
      setError(err.message || 'Failed to load artifact');
    } finally {
      setLoading(false);
    }
  }, [artifactManager, artifactId, fullArtifactId]);

  const loadFiles = useCallback(async () => {
    if (!artifactManager || !artifactId) return;
    setFilesLoading(true);
    try {
      const files = await artifactManager.list_files({ artifact_id: fullArtifactId });
      setFileList(Array.isArray(files) ? files : []);
    } catch {
      setFileList([]);
    } finally {
      setFilesLoading(false);
    }
  }, [artifactManager, artifactId, fullArtifactId]);

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/my-artifacts');
      return;
    }
    loadArtifact();
  }, [isLoggedIn, loadArtifact, navigate]);

  useEffect(() => {
    if (artifact) loadFiles();
  }, [artifact, loadFiles]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <svg className="w-10 h-10 text-[#f39200] animate-spin mx-auto mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-gray-500 text-sm">Loading artifact…</p>
        </div>
      </div>
    );
  }

  if (error || !artifact) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-3">{error || 'Artifact not found'}</p>
          <button onClick={() => navigate('/my-artifacts')} className="text-[#f39200] underline text-sm">
            ← Back to My Artifacts
          </button>
        </div>
      </div>
    );
  }

  const manifest: any = artifact.manifest || {};
  const alias = artifact.alias || artifact.id.split('/').pop() || '';
  const isGitStorage = !!(artifact as any).git_url;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/my-artifacts')}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              title="Back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">{manifest.name || alias}</h1>
              <p className="text-xs text-gray-400 font-mono truncate">{artifact.id}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={`/artifacts/${alias}`}
              className="inline-flex items-center gap-1.5 text-sm text-[#f39200] hover:text-[#d97f00] font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              View
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Git info box */}
        {isGitStorage && server && (
          <GitInfoBox artifact={artifact} server={server} />
        )}

        {/* Model info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Model Information
          </h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              { label: 'Name', value: manifest.name },
              { label: 'Type', value: manifest.type || artifact.type },
              { label: 'Version', value: manifest.version },
              { label: 'License', value: manifest.license },
              { label: 'Framework', value: manifest.framework },
              { label: 'Format version', value: manifest.format_version },
            ].filter(f => f.value).map(({ label, value }) => (
              <div key={label}>
                <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</dt>
                <dd className="text-gray-800 mt-0.5">{value}</dd>
              </div>
            ))}
            {manifest.description && (
              <div className="col-span-full">
                <dt className="text-xs font-medium text-gray-400 uppercase tracking-wide">Description</dt>
                <dd className="text-gray-800 mt-0.5">{manifest.description}</dd>
              </div>
            )}
          </dl>

          {/* Tags */}
          {manifest.tags?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {manifest.tags.map((tag: string) => (
                  <span key={tag} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Authors */}
          {manifest.authors?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Authors</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {manifest.authors.map((a: any, i: number) => (
                  <span key={i} className="text-sm text-gray-700">
                    {a.name}{a.affiliation ? <span className="text-gray-400 text-xs ml-1">({a.affiliation})</span> : null}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Versions */}
          {artifact.versions?.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">Versions</p>
              <div className="flex flex-wrap gap-1.5">
                {artifact.versions.map((v: any) => (
                  <span key={v.version} className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-mono">
                    {v.version}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* File list */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Files
              {fileList.length > 0 && (
                <span className="text-xs text-gray-400 font-normal">({fileList.length} items)</span>
              )}
            </h2>
            <button
              onClick={loadFiles}
              disabled={filesLoading}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            >
              <svg className={`w-3.5 h-3.5 ${filesLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {filesLoading ? (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">Loading files…</div>
          ) : fileList.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-gray-500 text-sm font-medium">No files yet</p>
              {isGitStorage && (
                <p className="text-gray-400 text-xs mt-1">
                  Use the Git commands above to push your model files.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {fileList.map((f, i) => (
                <div key={i} className="px-6 py-3 flex items-center gap-3 hover:bg-gray-50">
                  <span className="text-base">{f.type === 'directory' ? '📁' : fileIcon(f.name)}</span>
                  <span className="flex-1 text-sm font-mono text-gray-700 truncate">{f.name}</span>
                  {f.size !== undefined && f.size > 0 && (
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(f.size)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Citations */}
        {manifest.cite?.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-3">Citations</h2>
            <ul className="space-y-2">
              {manifest.cite.map((c: any, i: number) => (
                <li key={i} className="text-sm text-gray-600">
                  {c.text}
                  {c.doi && (
                    <a href={`https://doi.org/${c.doi}`} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#f39200] hover:underline text-xs">
                      [{c.doi}]
                    </a>
                  )}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[#f39200] hover:underline text-xs">
                      [link]
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>
    </div>
  );
};

export default Edit;
