import posthog from 'posthog-js';

const trackedRoutes = [
  '/',
  '/login',
  '/chat',
  '/chat/[sessionId]',
  '/account',
  '/explore',
  '/privacy',
  '/terms',
  '/about',
];

export class PostHogTracking {
  public postHogClient: typeof posthog | undefined = undefined;

  private static _instance: PostHogTracking;
  private _enabled = false;

  public static getInstance(): PostHogTracking {
    if (!PostHogTracking._instance) {
      PostHogTracking._instance = new PostHogTracking();
    }
    return PostHogTracking._instance;
  }

  private constructor() {
    if (typeof window === 'undefined') {
      return;
    }
    if (PostHogTracking._instance) {
      throw new Error(
        'Instance creation of PostHogTracking is not allowed. Use PostHogTracking.getInstance()',
      );
    }

    const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (posthogKey) {
      posthog.init(posthogKey, {
        api_host: "/relay-cAnL",
        ui_host: 'https://eu.posthog.com',
      });
      this._enabled = true;
      this.postHogClient = posthog;
    }
  }

  public track(event: string, properties: object = {}) {
    if (!this._enabled) {
      return;
    }
    posthog.capture(event, properties);
  }

  public identify(id: string) {
    if (!this._enabled) {
      return;
    }
    posthog.identify(id);
  }

  public alias(email: string, id: string) {
    if (!this._enabled) {
      return;
    }
    posthog.alias(email, id);
  }

  public setUserProperties(properties: object) {
    if (!this._enabled) {
      return;
    }
    posthog.people.set(properties);
  }

  public pageView(currentUrl: string, previousUrl: string | null | undefined) {
    if (trackedRoutes.some(route => currentUrl.includes(route))) {
      if (previousUrl) {
        this.track('$pageleave', {'$current_url': previousUrl});
      }
      this.track('$pageview', { '$current_url': currentUrl });
    }
  }

  // Authentication Events
  public userSignUp(userData: { 
    email?: string; 
    userId: string;
    inviteCode?: string;
  }) {
    if (!this._enabled) {
      return;
    }
    this.identify(userData.userId);
    if (userData.email) {
      this.alias(userData.email, userData.userId);
    }
    this.track('user_signup', { 
      email: userData.email,
      userId: userData.userId,
      inviteCode: userData.inviteCode,
    });
    this.setUserProperties({ 
      '$email': userData.email,
      '$first_login': new Date().toISOString(),
      'signup_date': new Date().toISOString(),
    });
  }

  public userSignIn(userData: { 
    email?: string; 
    userId: string;
  }) {
    if (!this._enabled) {
      return;
    }
    this.identify(userData.userId);
    this.track('user_signin', { 
      email: userData.email,
      userId: userData.userId,
    });
    this.setUserProperties({ 
      '$last_login': new Date().toISOString(),
    });
  }

  public userSignOut() {
    if (!this._enabled) {
      return;
    }
    this.track('user_signout');
    posthog.reset();
  }

  // Invite Events
  public inviteValidated(inviteCode: string, isValid: boolean) {
    if (!this._enabled) {
      return;
    }
    this.track('invite_validated', {
      inviteCode,
      isValid,
    });
  }

  public inviteRedeemed(inviteCode: string, userId: string) {
    if (!this._enabled) {
      return;
    }
    this.track('invite_redeemed', {
      inviteCode,
      userId,
    });
    this.setUserProperties({
      'used_invite_code': inviteCode,
      'invite_redeemed_at': new Date().toISOString(),
    });
  }

  // Chat Events
  public chatSessionCreated(sessionData: {
    sessionId: string;
    userId: string;
    channelId?: string;
    initialMessage?: string;
  }) {
    if (!this._enabled) {
      return;
    }
    this.track('chat_session_created', {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId,
      channelId: sessionData.channelId,
      hasInitialMessage: !!sessionData.initialMessage,
    });
    this.setUserProperties({
      'last_chat_session': sessionData.sessionId,
      'total_sessions': posthog.get_property('total_sessions') + 1 || 1,
    });
  }

  public messageSent(messageData: {
    sessionId: string;
    messageType: 'text' | 'voice' | 'image';
    messageLength?: number;
  }) {
    if (!this._enabled) {
      return;
    }
    this.track('message_sent', {
      sessionId: messageData.sessionId,
      messageType: messageData.messageType,
      messageLength: messageData.messageLength,
    });
    const messageCount = posthog.get_property('total_messages_sent') || 0;
    this.setUserProperties({
      'total_messages_sent': messageCount + 1,
      'last_message_type': messageData.messageType,
    });
  }

  public messageReceived(messageData: {
    sessionId: string;
    responseTime: number;
    thinkingTime?: number;
  }) {
    if (!this._enabled) {
      return;
    }
    this.track('message_received', {
      sessionId: messageData.sessionId,
      responseTime: messageData.responseTime,
      thinkingTime: messageData.thinkingTime,
    });
  }

  // Voice & Media Events
  public voiceMessageRecorded(duration: number) {
    if (!this._enabled) {
      return;
    }
    this.track('voice_message_recorded', {
      duration,
    });
    this.setUserProperties({
      'has_used_voice': true,
    });
  }

  public textToSpeechUsed(textLength: number) {
    if (!this._enabled) {
      return;
    }
    this.track('text_to_speech_used', {
      textLength,
    });
    this.setUserProperties({
      'has_used_tts': true,
    });
  }

  public mediaUploaded(mediaType: string, fileSize: number) {
    if (!this._enabled) {
      return;
    }
    this.track('media_uploaded', {
      mediaType,
      fileSize,
    });
    this.setUserProperties({
      'has_uploaded_media': true,
    });
  }

  // Agent & Connection Events
  public agentConnected(agentId: string) {
    if (!this._enabled) {
      return;
    }
    this.track('agent_connected', {
      agentId,
      timestamp: new Date().toISOString(),
    });
  }

  public agentDisconnected(agentId: string, reason?: string) {
    if (!this._enabled) {
      return;
    }
    this.track('agent_disconnected', {
      agentId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  public socketConnectionError(error: string) {
    if (!this._enabled) {
      return;
    }
    this.track('socket_connection_error', {
      error,
      timestamp: new Date().toISOString(),
    });
  }

  // Error Events
  public apiError(endpoint: string, statusCode: number, error: string) {
    if (!this._enabled) {
      return;
    }
    this.track('api_error', {
      endpoint,
      statusCode,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  public authError(errorType: string, errorMessage: string) {
    if (!this._enabled) {
      return;
    }
    this.track('auth_error', {
      errorType,
      errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // Feature Usage Events
  public sessionSelected(sessionId: string, messageCount: number) {
    if (!this._enabled) {
      return;
    }
    this.track('session_selected', {
      sessionId,
      messageCount,
    });
  }

  public sidebarToggled(isCollapsed: boolean) {
    if (!this._enabled) {
      return;
    }
    this.track('sidebar_toggled', {
      isCollapsed,
    });
  }

  public featureDiscovered(featureName: string) {
    if (!this._enabled) {
      return;
    }
    this.track('feature_discovered', {
      featureName,
      timestamp: new Date().toISOString(),
    });
    this.setUserProperties({
      [`discovered_${featureName}`]: true,
    });
  }

  // Session Analytics
  public sessionAnalytics(sessionData: {
    sessionId: string;
    duration: number;
    messageCount: number;
    avgResponseTime: number;
  }) {
    if (!this._enabled) {
      return;
    }
    this.track('session_analytics', {
      sessionId: sessionData.sessionId,
      duration: sessionData.duration,
      messageCount: sessionData.messageCount,
      avgResponseTime: sessionData.avgResponseTime,
    });
  }

  // User Identification Helper
  public identifyUser(userId: string, email?: string) {
    if (!this._enabled) {
      return;
    }
    this.identify(userId);
    if (email) {
      this.alias(email, userId);
      this.setUserProperties({
        '$email': email,
      });
    }
  }
}
