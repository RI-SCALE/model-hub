import React, { useState, useEffect, useCallback } from 'react';
import { useHyphaStore } from '../store/hyphaStore';
import { Link } from 'react-router-dom';

const PARENT_ID = 'ri-scale/ai-model-hub';
const SERVER_URL = 'https://hypha.aicell.io';

interface ArtifactItem {
  id: string;
  alias: string;
  manifest: {
    name?: string;
    description?: string;
    type?: string;
    tags?: string[];
  };
  git_url?: string;
  created_at: number;
  config?: Record<string, any>;
}

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy' }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
        copied
          ? 'bg-green-600 text-white'
          : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
      }`}
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
};

const CodeBlock: React.FC<{ code: string; onCopy?: () => void }> = ({ code }) => (
  <div className="relative group">
    <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
      {code}
    </pre>
    <div className="absolute top-2 right-2">
      <CopyButton text={code} />
    </div>
  </div>
);

interface CreateDialogProps {
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
  creating: boolean;
}

const CreateDialog: React.FC<CreateDialogProps> = ({ onClose, onCreate, creating }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showCliInfo, setShowCliInfo] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim(), description.trim());
  };

  // Preview the alias slug
  const aliasPreview = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Create New Artifact</h2>
        <p className="text-gray-500 text-sm mb-6">
          A Git repository will be created for your model. You can push files using Git and Git LFS.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. cellpose-v3-retrained"
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f39200] focus:border-transparent"
              required
              autoFocus
            />
            {aliasPreview && (
              <p className="text-xs text-gray-400 mt-1">
                Repository ID: <code className="bg-gray-100 px-1 rounded">{aliasPreview}</code>
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of your model..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#f39200] focus:border-transparent resize-none"
            />
          </div>

          {/* hypha-cli collapsible info */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowCliInfo(!showCliInfo)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700 transition-colors"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Prefer the command line? Use <code className="text-xs bg-white border border-gray-200 px-1 rounded">hypha-cli</code>
              </span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${showCliInfo ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showCliInfo && (
              <div className="px-4 py-4 bg-white space-y-3 text-sm text-gray-600">
                <p>
                  Install <a href="https://www.npmjs.com/package/hypha-cli" target="_blank" rel="noopener noreferrer" className="text-[#f39200] underline">hypha-cli</a>{' '}
                  and create your artifact from the terminal:
                </p>
                <div className="bg-gray-900 text-green-400 rounded-lg p-3 font-mono text-xs space-y-1">
                  <div className="text-gray-500"># Install once</div>
                  <div>npm install -g hypha-cli</div>
                  <div className="mt-2 text-gray-500"># Login and configure workspace</div>
                  <div>hypha --server https://hypha.aicell.io login</div>
                  <div className="mt-2 text-gray-500"># Create artifact with git storage</div>
                  <div>hypha --server https://hypha.aicell.io \</div>
                  <div>&nbsp;&nbsp;artifacts create {aliasPreview || 'my-model'} \</div>
                  <div>&nbsp;&nbsp;--type model \</div>
                  <div>&nbsp;&nbsp;--parent ri-scale/ai-model-hub</div>
                  <div className="mt-2 text-gray-500"># Generate a push token (30 days)</div>
                  <div>hypha --server https://hypha.aicell.io \</div>
                  <div>&nbsp;&nbsp;token --expires-in 2592000</div>
                </div>
                <p className="text-xs text-gray-400">
                  Note: Git storage is configured automatically when creating via this form. With the CLI, git storage must be enabled separately.
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="flex-1 bg-[#f39200] hover:bg-[#d97f00] disabled:bg-gray-300 text-white font-semibold py-2 rounded-lg transition-colors"
            >
              {creating ? 'Creating...' : 'Create Artifact'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={creating}
              className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ArtifactCardProps {
  artifact: ArtifactItem;
  server: any;
  expanded: boolean;
  onToggle: () => void;
}

const ArtifactCard: React.FC<ArtifactCardProps> = ({ artifact, server, expanded, onToggle }) => {
  const [gitAuthUrl, setGitAuthUrl] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [tokenExpiry, setTokenExpiry] = useState('7 days');

  const expiryOptions = [
    { label: '1 hour', seconds: 3600 },
    { label: '24 hours', seconds: 86400 },
    { label: '7 days', seconds: 604800 },
    { label: '30 days', seconds: 2592000 },
  ];

  const generateAuthUrl = async (expiresIn: number, label: string) => {
    if (!server || !artifact.git_url) return;
    setGeneratingToken(true);
    try {
      const token = await server.generateToken({ expires_in: expiresIn, _rkwargs: true });
      const gitUrl = new URL(artifact.git_url);
      gitUrl.username = 'git';
      gitUrl.password = token;
      setGitAuthUrl(gitUrl.toString());
      setTokenExpiry(label);
    } catch (err: any) {
      alert('Failed to generate token: ' + err.message);
    } finally {
      setGeneratingToken(false);
    }
  };

  const alias = artifact.alias || artifact.id.split('/').pop() || '';
  const displayName = artifact.manifest.name || alias;
  const publicGitUrl = artifact.git_url || `${SERVER_URL}/ri-scale/artifacts/${alias}/git`;
  // Use alias as directory name (it matches what git clone will create)
  const cloneDir = alias;

  const cloneCommands = gitAuthUrl
    ? `git clone ${gitAuthUrl} ${cloneDir}\ncd ${cloneDir}\ngit lfs install\n# Track large model files with LFS:\ngit lfs track "*.pt" "*.ckpt" "*.h5" "*.pkl" "*.pth" "*.safetensors" "*.bin"\ngit add .gitattributes\n# Add README and rdf.yaml:\necho "# ${displayName}" > README.md\ngit add README.md\ngit add .\ngit commit -m "Initial commit"\ngit push origin main`
    : `git clone ${publicGitUrl} ${cloneDir}\ncd ${cloneDir}`;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden hover:border-[#f39200] transition-colors">
      <button
        onClick={onToggle}
        className="w-full text-left p-5 flex items-center justify-between gap-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 truncate">
              {artifact.manifest.name || alias}
            </span>
            {artifact.git_url && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.6 10.59L8.38 4.8l1.69 1.7c-.24.85.15 1.78.93 2.23v5.54c-.6.34-1 .99-1 1.73a2 2 0 0 0 2 2 2 2 0 0 0 2-2c0-.74-.4-1.39-1-1.73V9.41l2.07 2.09c-.07.15-.07.32-.07.5a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0-2-2c-.2 0-.37.04-.54.1L11.08 6.98c.2-.87-.17-1.8-.98-2.23a2 2 0 0 0-2.74.76 2 2 0 0 0 .23 2.34L5.92 9.72l-1.7-1.7-1.62 2.57z"/>
                </svg>
                Git Storage
              </span>
            )}
            {artifact.manifest.type && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                {artifact.manifest.type}
              </span>
            )}
          </div>
          {artifact.manifest.description && (
            <p className="text-sm text-gray-500 mt-1 truncate">{artifact.manifest.description}</p>
          )}
          <p className="text-xs text-gray-400 mt-1">
            ID: <span className="font-mono">{alias}</span>
            {' · '}
            Created {new Date(artifact.created_at * 1000).toLocaleDateString()}
          </p>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-5 bg-gray-50 space-y-5">
          {/* View artifact link */}
          <div className="flex gap-3">
            <Link
              to={`/artifacts/${alias}`}
              className="inline-flex items-center gap-1.5 text-sm text-[#f39200] hover:text-[#d97f00] font-medium"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              View artifact page
            </Link>
          </div>

          {/* Public read-only URL */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Public clone URL (read-only)
            </h4>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm font-mono text-gray-700 truncate">
                {publicGitUrl}
              </code>
              <CopyButton text={publicGitUrl} />
            </div>
          </div>

          {/* Authenticated URL section */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Authenticated URL (read + push)
            </h4>

            {!gitAuthUrl ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-500">Generate a time-limited token to push files:</span>
                <div className="flex gap-2 flex-wrap">
                  {expiryOptions.map(opt => (
                    <button
                      key={opt.label}
                      onClick={() => generateAuthUrl(opt.seconds, opt.label)}
                      disabled={generatingToken}
                      className="px-3 py-1.5 bg-[#f39200] hover:bg-[#d97f00] disabled:bg-gray-300 text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      {generatingToken ? 'Generating...' : `${opt.label} token`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <svg className="w-4 h-4 text-yellow-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-xs text-yellow-700">
                    This URL contains your personal token (valid {tokenExpiry}). Keep it private and don't share it.
                  </span>
                  <button
                    onClick={() => setGitAuthUrl(null)}
                    className="ml-auto text-xs text-yellow-700 underline hover:no-underline"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-white border border-gray-200 rounded px-3 py-2 text-sm font-mono text-gray-700 truncate">
                    {gitAuthUrl}
                  </code>
                  <CopyButton text={gitAuthUrl} />
                </div>
              </div>
            )}
          </div>

          {/* Git commands */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 3h2v2H3V3zm4 0h2v2H7V3zm4 0h2v2h-2V3zm-8 4h2v2H3V7zm4 0h2v2H7V7zm4 0h2v2h-2V7zm4 0h2v2h-2V7zm0 4h2v2h-2v-2zm-4 0h2v2h-2v-2zM3 11h2v2H3v-2zm8 4h2v2h-2v-2zm4 0h2v2h-2v-2zM3 15h2v2H3v-2z"/>
              </svg>
              Git commands
            </h4>
            <CodeBlock code={cloneCommands} />
            {!gitAuthUrl && (
              <p className="text-xs text-gray-400 mt-2">
                Generate an authenticated URL above to get push-enabled commands.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

interface UploadProps {
  artifactId?: string;
}

const Upload: React.FC<UploadProps> = () => {
  const { artifactManager, server, isLoggedIn, user } = useHyphaStore();
  const [myArtifacts, setMyArtifacts] = useState<ArtifactItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMyArtifacts = useCallback(async () => {
    if (!artifactManager || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await artifactManager.list({
        parent_id: PARENT_ID,
        filters: { created_by: user.id },
        limit: 100,
        _rkwargs: true,
      });
      setMyArtifacts(Array.isArray(result) ? result : result?.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load artifacts');
    } finally {
      setLoading(false);
    }
  }, [artifactManager, user?.id]);

  useEffect(() => {
    if (isLoggedIn) {
      fetchMyArtifacts();
    }
  }, [isLoggedIn, fetchMyArtifacts]);

  const handleCreate = async (name: string, description: string) => {
    if (!artifactManager) return;
    setCreating(true);
    try {
      // Derive a clean alias slug from the name
      const alias = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);

      const manifest: Record<string, any> = {
        name,
        description,
        documentation: 'README.md',
        format_version: '0.1.0',
      };
      if (user?.email) manifest.uploader = { email: user.email };

      const artifact = await artifactManager.create({
        alias,
        parent_id: PARENT_ID,
        type: 'model',
        manifest,
        config: { storage: 'git' },
        stage: false,
        _rkwargs: true,
      });

      setShowCreateDialog(false);
      await fetchMyArtifacts();
      setExpandedId(artifact.id || artifact.alias);
    } catch (err: any) {
      alert('Failed to create artifact: ' + (err.message || err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Contribute a Model</h1>
              <p className="mt-2 text-gray-500 text-base">
                Submit your AI models to the RI-SCALE model hub using Git and Git LFS.
              </p>
            </div>
            {isLoggedIn && (
              <button
                onClick={() => setShowCreateDialog(true)}
                className="inline-flex items-center gap-2 bg-[#f39200] hover:bg-[#d97f00] text-white font-semibold px-5 py-2.5 rounded-xl shadow-sm transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create New Artifact
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* How it works */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                step: '1',
                title: 'Create an artifact',
                desc: 'Click "Create New Artifact" to register your model in the hub. A Git repository is created automatically.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ),
              },
              {
                step: '2',
                title: 'Generate credentials',
                desc: 'Expand your artifact and generate a time-limited personal access token to push files.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                ),
              },
              {
                step: '3',
                title: 'Push with Git & LFS',
                desc: 'Use standard Git commands. Large files (weights, checkpoints) are handled automatically via Git LFS.',
                icon: (
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                ),
              },
            ].map(({ step, title, desc, icon }) => (
              <div key={step} className="flex gap-3">
                <div className="flex-shrink-0 w-10 h-10 bg-[#f39200] bg-opacity-10 text-[#f39200] rounded-xl flex items-center justify-center">
                  {icon}
                </div>
                <div>
                  <p className="text-xs font-bold text-[#f39200] uppercase tracking-wide mb-0.5">Step {step}</p>
                  <p className="font-semibold text-gray-900 text-sm">{title}</p>
                  <p className="text-gray-500 text-xs mt-1">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick start snippet */}
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-sm font-medium text-gray-700 mb-2">Quick start (after creating and getting your authenticated URL):</p>
            <CodeBlock
              code={`git clone https://git:<TOKEN>@hypha.aicell.io/ri-scale/artifacts/<your-alias>/git
cd <your-alias>
git lfs install
git lfs track "*.pt" "*.ckpt" "*.h5" "*.pkl" "*.pth" "*.safetensors" "*.bin"
git add .gitattributes
# Add your model files, README.md, rdf.yaml, etc.
git add .
git commit -m "Initial model upload"
git push origin main`}
            />
          </div>
        </div>

        {/* My Artifacts */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">My Artifacts</h2>
            {isLoggedIn && (
              <button
                onClick={fetchMyArtifacts}
                disabled={loading}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1.5"
              >
                <svg
                  className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            )}
          </div>

          {!isLoggedIn ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <h3 className="font-semibold text-gray-700 mb-1">Login to contribute</h3>
              <p className="text-sm text-gray-500">
                Please log in to create artifacts and see your existing contributions.
              </p>
            </div>
          ) : loading ? (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <svg className="w-8 h-8 text-[#f39200] animate-spin mx-auto" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-500 mt-3">Loading your artifacts...</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
              <p className="text-red-700 text-sm">{error}</p>
              <button onClick={fetchMyArtifacts} className="mt-2 text-sm text-red-600 underline">
                Try again
              </button>
            </div>
          ) : myArtifacts.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
              <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              <h3 className="font-semibold text-gray-700 mb-1">No artifacts yet</h3>
              <p className="text-sm text-gray-500 mb-4">
                You haven't contributed any models yet. Create your first artifact to get started.
              </p>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="inline-flex items-center gap-2 bg-[#f39200] hover:bg-[#d97f00] text-white font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create New Artifact
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myArtifacts.map(artifact => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  server={server}
                  expanded={expandedId === artifact.id || expandedId === artifact.alias}
                  onToggle={() =>
                    setExpandedId(
                      expandedId === artifact.id || expandedId === artifact.alias
                        ? null
                        : artifact.id
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreateDialog && (
        <CreateDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreate}
          creating={creating}
        />
      )}
    </div>
  );
};

export default Upload;
