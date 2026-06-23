import React, { useState } from 'react';
import { PencilIcon, TrashIcon, ArrowDownTrayIcon, EyeIcon, EyeSlashIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';
import { formatDistanceToNow } from 'date-fns';
import StatusBadge from './StatusBadge';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Tooltip, IconButton, CircularProgress } from '@mui/material';

interface Author {
  name: string;
}

interface AdminResourceCardProps {
  title: string;
  description: string;
  tags: string[];
  image?: string;
  downloadUrl?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  isStaged?: boolean;
  status: 'staged' | 'published' | 'deletion-requested';
  authors?: Author[];
  createdAt?: number;
  lastModified?: number;
  artifactType?: string;
  isCollectionAdmin?: boolean;
  onRequestDeletion?: () => void;
  id: string;
  emoji?: string;
  isLoading?: boolean;
  deletionRequestLoading?: boolean;
  /** True if this artifact has config.published === true (visible in public catalogue). */
  isPublished?: boolean;
  /** Called when user clicks Publish or Unpublish — receives the new state. */
  onTogglePublish?: (publish: boolean) => void;
  publishLoading?: boolean;
}

const MyArtifactCard: React.FC<AdminResourceCardProps> = ({
  title,
  description,
  tags,
  image,
  downloadUrl,
  onEdit,
  onDelete,
  isStaged,
  status,
  authors = [],
  createdAt,
  lastModified,
  artifactType,
  isCollectionAdmin = false,
  onRequestDeletion,
  id,
  emoji,
  isLoading = false,
  deletionRequestLoading = false,
  isPublished = false,
  onTogglePublish,
  publishLoading = false,
}) => {
  const [showCopied, setShowCopied] = useState(false);

  const handleClick = (e: React.MouseEvent, callback?: () => void) => {
    e.stopPropagation();
    if (callback) callback();
  };

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id.split('/').pop() || '');
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  return (
    <div className={`relative bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow duration-200 h-[300px] flex flex-col ${
      isStaged ? 'bg-yellow-50' : ''
    }`}>
      
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2">
        
        {artifactType && (
          <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-800 ring-1 ring-inset ring-purple-600/20">
            {artifactType}
          </span>
        )}
        {isStaged ? (
          <span className="inline-flex items-center rounded-md bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-800 ring-1 ring-inset ring-yellow-600/20">
            Staged
          </span>
        ) : isPublished ? (
          <span className="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-600/20">
            Published
          </span>
        ) : (
          <span className="inline-flex items-center rounded-md bg-orange-50 px-2 py-1 text-xs font-medium text-orange-800 ring-1 ring-inset ring-orange-600/20">
            Draft
          </span>
        )}
        {status && <StatusBadge status={status} size="small" />}
        
      </div>
      
      <div className="p-4 mt-5">
        <div className="flex-none">
          <div className="flex items-center gap-2 mb-2">
            {emoji && <span className="text-xl">{emoji}</span>}
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500 mb-3">
            <div className="flex items-center gap-1 bg-gray-50 rounded-md px-2 py-1">
              <span className="font-medium">ID:</span>
              <code className="font-mono">{id.split('/').pop()}</code>
              <Tooltip title="Copy ID" placement="top">
                <IconButton
                  onClick={handleCopyId}
                  size="small"
                  className="ml-1 text-gray-400 hover:text-gray-600"
                  sx={{ padding: '2px' }}
                >
                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              {showCopied && (
                <span className="text-green-600 ml-1">Copied!</span>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-4 line-clamp-2">{description}</p>
        </div>
        
        <div className="flex-1">
          {authors.length > 0 && (
            <div className="mb-3 text-sm text-gray-600">
              By: {authors.map(author => author.name).join(', ')}
            </div>
          )}

          <div className="mb-3 text-xs text-gray-500">
            {createdAt && (
              <div>Created: {formatDistanceToNow(createdAt * 1000)} ago</div>
            )}
            {lastModified && (
              <div>Modified: {formatDistanceToNow(lastModified * 1000)} ago</div>
            )}
          </div>
          
          <div className="flex flex-wrap gap-2 overflow-hidden h-6">
            {tags.slice(0, 5).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600 whitespace-nowrap"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-4 border-t pt-3 flex-none">
          {/* Left: icon-only secondary actions with tooltips */}
          <div className="flex items-center gap-0.5">
            <Tooltip title="Edit metadata" placement="top">
              <span>
                <IconButton
                  onClick={(e) => handleClick(e, onEdit)}
                  size="small"
                  disabled={isLoading}
                  sx={{ color: '#6b7280', '&:hover': { color: '#2563eb', backgroundColor: '#eff6ff' } }}
                >
                  <PencilIcon className="w-4 h-4" />
                </IconButton>
              </span>
            </Tooltip>
            {onDelete && (
              <Tooltip title="Delete this artifact" placement="top">
                <span>
                  <IconButton
                    onClick={(e) => handleClick(e, onDelete)}
                    size="small"
                    disabled={isLoading}
                    sx={{ color: '#6b7280', '&:hover': { color: '#dc2626', backgroundColor: '#fef2f2' } }}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {downloadUrl && (
              <Tooltip title="Download as zip" placement="top">
                <span>
                  <IconButton
                    component="a"
                    href={downloadUrl}
                    onClick={(e) => e.stopPropagation()}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="small"
                    sx={{ color: '#6b7280', '&:hover': { color: '#0891b2', backgroundColor: '#ecfeff' } }}
                  >
                    <ArrowDownTrayIcon className="w-4 h-4" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </div>

          {/* Right: primary publish/unpublish action */}
          {onTogglePublish && !isStaged && (
            isPublished ? (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePublish(false); }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-orange-700 border border-orange-300 rounded-full hover:bg-orange-50 disabled:opacity-50 transition-colors"
                title="Remove from public catalogue (returns to draft)"
                disabled={isLoading || publishLoading}
              >
                {publishLoading ? <CircularProgress size={12} sx={{ color: '#d97f00' }} /> : <EyeSlashIcon className="w-3.5 h-3.5" />}
                <span>Unpublish</span>
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePublish(true); }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-orange-500 rounded-full hover:bg-orange-600 disabled:opacity-50 transition-colors shadow-sm"
                title="Make this model visible in the public catalogue"
                disabled={isLoading || publishLoading}
              >
                {publishLoading ? <CircularProgress size={12} sx={{ color: 'white' }} /> : <CloudArrowUpIcon className="w-3.5 h-3.5" />}
                <span>Publish</span>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
};

export default MyArtifactCard; 