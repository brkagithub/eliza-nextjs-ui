'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { usePrivy } from '@privy-io/react-auth';
import ChatPreviewSlider from '@/components/login/chat-preview-slider';
import LoginForm from '@/components/login/login-form';
import { PostHogTracking } from '@/lib/posthog';
import { useUserManager } from '@/lib/user-manager';

interface InviteValidationResult {
  valid: boolean;
  invite?: {
    id: string;
    code: string;
    is_legacy: boolean;
    expires_at: string;
  };
  error?: string;
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, logout, authenticated, ready, user } = usePrivy();
  const { getUserId } = useUserManager();
  
  const [inviteCode, setInviteCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [validationResult, setValidationResult] = useState<InviteValidationResult | null>(null);
  const [error, setError] = useState('');
  const [isCheckingExistingUser, setIsCheckingExistingUser] = useState(false);
  const [showExistingUserMode, setShowExistingUserMode] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);

  // Check for invite code in URL params on mount
  useEffect(() => {
    const urlInviteCode = searchParams.get('invite');
    if (urlInviteCode) {
      setInviteCode(urlInviteCode);
      validateInvite(urlInviteCode);
    }
    
    // Check for error params
    const errorParam = searchParams.get('error');
    if (errorParam === 'not-invited') {
      setError('You need an invite code to access AUBRAI. Please enter your invite code below.');
    } else if (errorParam === 'auth-error') {
      setError('Authentication error. Please try again.');
    }
  }, [searchParams]);

  // Handle post-authentication flow
  useEffect(() => {
    const checkUserAndProceed = async () => {
      if (!authenticated || !user?.id) return;
      
      // If we have a valid invite, redeem it
      if (validationResult?.valid && inviteCode) {
        await handleInviteRedemption();
        return;
      }
      
      // Otherwise, check if user exists in database
      setIsCheckingExistingUser(true);
      try {
        const { getUserRowIdByPrivyId } = await import('@/services/user-service');
        const existingUserId = await getUserRowIdByPrivyId(user.id);
        
        if (existingUserId) {
          // User exists, show loading animation during redirect
          setIsRedirecting(true);
          console.log('[LoginPage] Existing user found, redirecting...');
          
          // Track user sign in
          PostHogTracking.getInstance().userSignIn({
            email: user.email?.address,
            userId: getUserId(),
          });
          
          // Check for return URL parameter
          const returnUrl = searchParams.get('returnUrl');
          if (returnUrl) {
            router.push(decodeURIComponent(returnUrl));
          } else {
            router.push('/chat');
          }
        } else {
          // User doesn't exist - they need an invite
          console.log('[LoginPage] User not in database, logging out');
          setError('You need an invite code to access AUBRAI. Please enter your invite code below.');
          setIsAuthenticating(false);
          // Clear any cached auth data
          try {
            localStorage.removeItem('aubrai:auth');
            localStorage.removeItem('cachedUserIds');
          } catch {}
          // Log them out
          await logout();
        }
      } catch (error: any) {
        console.error('[LoginPage] Error checking user:', error);
        // More specific error handling
        if (error?.message?.includes('not found') || error?.code === 'PGRST116') {
          setError('You need an invite code to access AUBRAI. Please enter your invite code below.');
        } else {
          setError('Error connecting to the server. Please try again.');
          PostHogTracking.getInstance().authError('user_check_failed', error?.message || 'Unknown error');
        }
        setIsAuthenticating(false);
        await logout();
      } finally {
        setIsCheckingExistingUser(false);
      }
    };
    
    checkUserAndProceed();
  }, [authenticated, validationResult, inviteCode, user?.id, router]);

  const validateInvite = async (code: string): Promise<boolean> => {
    if (!code) return false;
    
    setIsValidating(true);
    setError('');
    
    try {
      const response = await fetch('/api/invites/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const result = await response.json();
      
      if (response.ok && result.valid) {
        setValidationResult(result);
        setError('');
        PostHogTracking.getInstance().inviteValidated(code, true);
        return true;
      } else {
        setError(result.error || 'Invalid invite code');
        setValidationResult({ valid: false });
        PostHogTracking.getInstance().inviteValidated(code, false);
        return false;
      }
    } catch (err) {
      setError('Failed to validate invite code');
      setValidationResult({ valid: false });
      PostHogTracking.getInstance().inviteValidated(code, false);
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleInviteSubmit = async (code: string) => {
    if (!code.trim()) {
      setError('Please enter an invite code');
      return;
    }

    setInviteCode(code);
    
    // Validate invite first
    const result = await validateInvite(code);
    if (!result) return;

    // If valid, proceed with authentication
    setIsAuthenticating(true);
    try {
      await login();
    } catch (err) {
      setError('Authentication failed');
      setIsAuthenticating(false);
      PostHogTracking.getInstance().authError('invite_login_failed', err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const handleSignIn = async () => {
    setError('');
    setIsAuthenticating(true);
    setShowExistingUserMode(true);
    
    try {
      await login();
    } catch (err) {
      setError('Authentication failed');
      setIsAuthenticating(false);
      PostHogTracking.getInstance().authError('existing_user_login_failed', err instanceof Error ? err.message : 'Authentication failed');
    }
  };

  const handleInviteRedemption = async () => {
    if (!inviteCode || !user?.id || !validationResult?.valid) return;
    
    try {
      console.log('Privy user object:', user);
      const requestBody = {
        code: inviteCode,
        userId: user.id,
        email: user.email?.address
      };
      console.log('Sending redeem request:', requestBody);
      
      const response = await fetch('/api/invites/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('Redeem response status:', response.status, response.ok);
      
      // Try to get response text first
      const responseText = await response.text();
      console.log('Raw response:', responseText);
      
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch (e) {
        console.error('Failed to parse response:', e);
        data = { error: 'Invalid response from server' };
      }

      if (response.ok) {
        console.log('Redeem success:', data);
        
        // Track invite redemption and user signup
        PostHogTracking.getInstance().inviteRedeemed(inviteCode, getUserId());
        PostHogTracking.getInstance().userSignUp({
          email: user.email?.address,
          userId: getUserId(),
          inviteCode,
        });
        
        // Keep loading animation during redirect process
        console.log('[LoginPage] Invite redeemed successfully, preparing redirect...');
        
        // Small delay to ensure auth state is properly set
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Set redirecting state for better UX
        setIsRedirecting(true);
        
        // Check for return URL parameter
        const returnUrl = searchParams.get('returnUrl');
        console.log('[LoginPage] Redirecting user to:', returnUrl || '/chat');
        
        if (returnUrl) {
          router.push(decodeURIComponent(returnUrl));
        } else {
          router.push('/chat');
        }
        // Note: Animation continues until page navigation completes
      } else {
        console.error('Redeem error:', data);
        if (data.details) {
          console.error('Error details:', data.details);
        }
        if (data.type) {
          console.error('Error type:', data.type);
        }
        setError(data.error || `Failed to redeem invite (${response.status})`);
        setIsAuthenticating(false);
      }
    } catch (err) {
      console.error('Error during invite redemption:', err);
      setError('An error occurred. Please try again.');
      setIsAuthenticating(false);
    }
  };

  // Show loading state while Privy initializes
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF6E71] mb-4"></div>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">Initializing...</p>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-white dark:bg-black">
      {/* Left Panel - Auth Section - Full width on mobile, 50% on desktop */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-4 sm:p-6 md:p-6 lg:p-8 min-h-screen lg:min-h-auto">
        <div className="w-full max-w-sm sm:max-w-md md:max-w-md lg:max-w-md xl:max-w-md">
          {/* Logo */}
          <div className="mb-6 sm:mb-6 md:mb-8 lg:mb-8 text-center lg:text-left">
            <Image 
              src="/assets/aubrai_logo_white.png" 
              alt="AUBRAI" 
              width={180} 
              height={45} 
              className="h-10 sm:h-12 md:h-12 lg:h-12 w-auto mx-auto lg:mx-0"
            />
          </div>

          {/* Main Content */}
          <div className="space-y-4 sm:space-y-5 md:space-y-5 lg:space-y-6">
            {/* Hero Section */}
            <div className="text-center lg:text-left">
              <h1 className="text-xl sm:text-2xl md:text-2xl lg:text-3xl xl:text-3xl font-bold text-zinc-900 dark:text-white mb-2 sm:mb-3 leading-tight">
                Your longevity co-pilot
              </h1>
              <p className="text-sm sm:text-base md:text-base lg:text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Expert AI guidance from Dr. Aubrey de Grey&apos;s research.
              </p>
            </div>

            {/* Welcome Message for New Users */}
            <div className="relative bg-gradient-to-r from-[#FF6E71]/10 to-[#FF6E71]/5 dark:from-[#FF6E71]/20 dark:to-[#FF6E71]/10 border border-[#FF6E71]/30 dark:border-[#FF6E71]/40 rounded-lg p-3 sm:p-4 md:p-4 lg:p-4 overflow-hidden">
              <div className="absolute top-0 right-0 w-12 sm:w-16 h-12 sm:h-16 bg-[#FF6E71]/5 rounded-full blur-xl"></div>
              <div className="relative flex items-start gap-2 sm:gap-3">
                <div className="flex-shrink-0 w-1.5 h-1.5 bg-[#FF6E71] rounded-full mt-2 animate-pulse" />
                <div className="text-xs sm:text-sm">
                  <p className="text-[#FF6E71] dark:text-[#FF6E71] font-semibold mb-1">Welcome to AUBRAI</p>
                  <p className="text-[#FF6E71]/80 dark:text-[#FF6E71]/70 leading-relaxed">
                    Join thousands exploring longevity science with AI-powered insights from cutting-edge research.
                  </p>
                </div>
              </div>
            </div>

            {/* Auth Container */}
            <div className="pt-2 sm:pt-3 md:pt-4 relative">
              <LoginForm
                onInviteSubmit={handleInviteSubmit}
                onSignIn={handleSignIn}
                isValidating={isValidating}
                isAuthenticating={isAuthenticating}
                error={error}
                isCheckingUser={isCheckingExistingUser}
              />
              
              {/* Loading overlay for user authentication checks */}
              {(isAuthenticating || isCheckingExistingUser || isRedirecting) && (
                <div className="absolute inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF6E71] mb-3"></div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {isRedirecting ? 'Redirecting you...' :
                       isCheckingExistingUser ? 'Verifying account...' : 
                       isValidating ? 'Validating invite...' : 
                       'Signing you in...'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Chat Preview Slider - Hidden on mobile, 50% on desktop */}
      <div className="hidden lg:block lg:w-1/2 bg-zinc-50 dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-700">
        <ChatPreviewSlider />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-black">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#FF6E71] mb-4"></div>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">Loading...</p>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}