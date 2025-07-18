'use client';

import { PaperClipIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { useUserManager } from '@/lib/user-manager';
import { PostHogTracking } from '@/lib/posthog';

interface FileUploadButtonProps {
  onFileUpload: (file: File, uploadResult: any) => void;
  disabled?: boolean;
  className?: string;
  isUploading?: boolean;
  onUploadStateChange?: (isUploading: boolean) => void;
}

const SUPPORTED_MIME_TYPES = [
  // Text files
  'text/plain',
  'text/markdown',
  'text/html',
  'text/csv',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Data formats
  'application/json',
  'application/xml',
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const FileUploadButton = ({ 
  onFileUpload, 
  disabled, 
  className, 
  isUploading: externalIsUploading, 
  onUploadStateChange 
}: FileUploadButtonProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [internalIsUploading, setInternalIsUploading] = useState(false);
  const { getUserId } = useUserManager();

  // Use external state if provided, otherwise use internal state
  const isUploading = externalIsUploading !== undefined ? externalIsUploading : internalIsUploading;

  const handleButtonClick = () => {
    if (disabled || isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset the input value so the same file can be selected again
    event.target.value = '';

    // Validate file type
    if (!SUPPORTED_MIME_TYPES.includes(file.type)) {
      alert(`Unsupported file type: ${file.type}`);
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      alert('File is too large. Maximum size is 50MB.');
      return;
    }

    // Set uploading state
    if (onUploadStateChange) {
      onUploadStateChange(true);
    } else {
      setInternalIsUploading(true);
    }

    try {
      const agentId = process.env.NEXT_PUBLIC_AGENT_ID;
      const userId = getUserId();

      if (!agentId) {
        throw new Error('Agent ID not configured');
      }

      if (!userId) {
        throw new Error('User ID not available');
      }

      // Create FormData
      const formData = new FormData();
      formData.append('files', file); // Note: 'files' not 'file' for knowledge upload

      // Upload via the dedicated upload API route
      const response = await fetch(
        `/api/upload-media?agentId=${agentId}&userId=${encodeURIComponent(userId)}`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Upload failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // Track media upload
        PostHogTracking.getInstance().mediaUploaded(file.type, file.size);
        
        // Check if this is first time uploading a file
        const hasUploadedFile = localStorage.getItem('discovered_file_upload');
        if (!hasUploadedFile) {
          PostHogTracking.getInstance().featureDiscovered('file_upload');
          localStorage.setItem('discovered_file_upload', 'true');
        }
        
        onFileUpload(file, result.data);
      } else {
        throw new Error(result.error?.message || 'Upload failed');
      }
    } catch (error) {
      console.error('File upload error:', error);
      alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Clear uploading state
      if (onUploadStateChange) {
        onUploadStateChange(false);
      } else {
        setInternalIsUploading(false);
      }
    }
  };

  return (
    <>
      <Button
        type="button"
        onClick={handleButtonClick}
        disabled={disabled || isUploading}
        aria-label="Upload file"
        className={clsx(
          'size-10',
          isUploading && !disabled
            ? ' border text-brand hover:border-brand-hover text-white shadow-lg'
            : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 hover:border-zinc-600 text-zinc-400 hover:text-zinc-300 hover:border-brand/30',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        {isUploading && !disabled ? (
          <Loader2 className="!h-5 !w-5 !shrink-0 animate-spin text-white" />
        ) : (
          <PaperClipIcon className={clsx(
            "!h-5 !w-5 !shrink-0 transition-all duration-200",
            "text-zinc-400"
          )} />
        )}
      </Button>

      <input
        ref={fileInputRef}
        type="file"
        accept={[
          ...SUPPORTED_MIME_TYPES,
          // Add file extensions for better UX
          '.txt',
          '.md',
          '.markdown',
          '.log',
          '.ini',
          '.cfg',
          '.conf',
          '.env',
          '.js',
          '.jsx',
          '.ts',
          '.tsx',
          '.py',
          '.java',
          '.c',
          '.cpp',
          '.cs',
          '.php',
          '.rb',
          '.go',
          '.rs',
          '.swift',
          '.kt',
          '.scala',
          '.html',
          '.css',
          '.vue',
          '.svelte',
          '.pdf',
          '.doc',
          '.docx',
          '.json',
          '.xml',
          '.yaml',
          '.yml',
          '.csv',
          '.tsv',
          '.sh',
          '.bash',
          '.zsh',
          '.fish',
          '.ps1',
          '.bat',
          '.cmd',
        ].join(',')}
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  );
};

export default FileUploadButton;
