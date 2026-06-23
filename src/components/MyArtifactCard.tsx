import React, { useState } from 'react';
import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
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

        <div className="flex flex-wrap items-center gap-1.5 mt-4 border-t pt-3 flex-none">
          <button
            onClick={(e) => handleClick(e, onEdit)}
            className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-blue-600 rounded hover:bg-blue-50 disabled:opacity-50"
            title="Edit"
            disabled={isLoading}
          >
            <PencilIcon className="w-4 h-4" />
            <span className="ml-1">Edit</span>
          </button>
          {onDelete && (
            <button
              onClick={(e) => handleClick(e, onDelete)}
              className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-red-600 rounded hover:bg-red-50 disabled:opacity-50"
              title="Delete"
              disabled={isLoading}
            >
              <TrashIcon className="w-4 h-4" />
              <span className="ml-1">Delete</span>
            </button>
          )}
          {onTogglePublish && !isStaged && (
            isPublished ? (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePublish(false); }}
                className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-orange-600 rounded hover:bg-orange-50 disabled:opacity-50"
                title="Remove from public catalogue (returns to draft)"
                disabled={isLoading || publishLoading}
              >
                {publishLoading ? <CircularProgress size={14} /> : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                )}
                <span className="ml-1">Unpublish</span>
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePublish(true); }}
                className="flex items-center px-2 py-1 text-xs text-white bg-orange-500 hover:bg-orange-600 rounded disabled:opacity-50"
                title="Make this model visible in the public catalogue"
                disabled={isLoading || publishLoading}
              >
                {publishLoading ? <CircularProgress size={14} sx={{ color: 'white' }} /> : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                )}
                <span className="ml-1">Publish</span>
              </button>
            )
          )}
          {downloadUrl && (
            <a
              href={downloadUrl}
              onClick={(e) => e.stopPropagation()}
              className="ml-auto text-xs text-blue-600 hover:text-blue-800"
              target="_blank"
              rel="noopener noreferrer"
            >
              Download
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default MyArtifactCard; 