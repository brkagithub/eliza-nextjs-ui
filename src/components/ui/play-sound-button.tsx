'use client';

import { SpeakerWaveIcon } from '@heroicons/react/24/outline';
import { Loader2 } from 'lucide-react';
import { useState, useRef } from 'react';
import { Button } from '@/components/ui';
import { PostHogTracking } from '@/lib/posthog';

interface PlaySoundButtonProps {
  text: string;
  className?: string;
}

export const PlaySoundButton = ({ text, className }: PlaySoundButtonProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlay = async () => {
    if (isLoading || isPlaying) return;

    try {
      setIsLoading(true);

      // Clean the text - remove markdown and HTML tags
      const cleanText = text
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .replace(/`[^`]*`/g, '') // Remove inline code
        .replace(/\*\*([^*]*)\*\*/g, '$1') // Remove bold markdown
        .replace(/\*([^*]*)\*/g, '$1') // Remove italic markdown
        .replace(/#{1,6}\s+/g, '') // Remove headers
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Remove links, keep text
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .trim();

      if (!cleanText) {
        console.warn('[PlaySound] No text to convert after cleaning');
        return;
      }

      console.log(`[PlaySound] Converting text to speech: "${cleanText.substring(0, 100)}..."`);

      const response = await fetch('/api/text-to-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: cleanText }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `TTS failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Stop current audio if playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Create new audio element
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onloadstart = () => {
        setIsLoading(false);
        setIsPlaying(true);
        
        // Track TTS usage
        PostHogTracking.getInstance().textToSpeechUsed(cleanText.length);
        
        // Check if this is first time using TTS
        const hasUsedTTS = localStorage.getItem('discovered_text_to_speech');
        if (!hasUsedTTS) {
          PostHogTracking.getInstance().featureDiscovered('text_to_speech');
          localStorage.setItem('discovered_text_to_speech', 'true');
        }
      };

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = (error) => {
        console.error('[PlaySound] Audio playback error:', error);
        setIsPlaying(false);
        setIsLoading(false);
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
    } catch (error) {
      console.error('[PlaySound] Error:', error);
      setIsLoading(false);
      setIsPlaying(false);

      // Show user-friendly error
      alert(`Failed to play audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={isPlaying ? handleStop : handlePlay}
      disabled={isLoading}
      plain
      aria-label={isPlaying ? 'Stop audio' : 'Play audio'}
      className={`size-6 ${className}`}
    >
      {isLoading ? (
        <Loader2 className="!h-3 !w-3 !shrink-0 animate-spin" />
      ) : (
        <SpeakerWaveIcon className={`!h-3 !w-3 !shrink-0 ${isPlaying ? 'text-blue-500' : ''}`} />
      )}
    </Button>
  );
};

export default PlaySoundButton;
