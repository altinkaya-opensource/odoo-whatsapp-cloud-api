/**
 * Event Broadcasting System
 *
 * In-memory pub/sub system for broadcasting webhook events to active SSE connections.
 * For multi-instance deployments, replace with Redis pub/sub.
 */

type EventCallback = (data: unknown) => void;

/**
 * Listener metadata for access control
 */
interface ListenerMetadata {
  callback: EventCallback;
  allowedBackendIds: number[];
  sessionId: string;
}

class EventBroadcaster {
  private channels = new Map<string, Set<ListenerMetadata>>();

  /**
   * Subscribe to a channel with backend access control
   * @param channel - Channel name (e.g., "threads", "messages:123")
   * @param callback - Function to call when event is broadcast
   * @param metadata - Access control metadata
   * @returns Unsubscribe function
   */
  subscribe(
    channel: string,
    callback: EventCallback,
    metadata: { allowedBackendIds: number[]; sessionId: string }
  ): () => void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }

    const listener: ListenerMetadata = {
      callback,
      allowedBackendIds: metadata.allowedBackendIds,
      sessionId: metadata.sessionId,
    };

    this.channels.get(channel)!.add(listener);

    console.log(
      `[EventBroadcaster] Subscribed to channel: ${channel} ` +
        `(backends: [${metadata.allowedBackendIds.join(", ")}], ` +
        `listeners: ${this.getListenerCount(channel)})`
    );

    // Return unsubscribe function
    return () => {
      this.unsubscribe(channel, listener);
    };
  }

  /**
   * Unsubscribe from a channel
   * @param channel - Channel name
   * @param listener - Listener metadata to remove
   */
  private unsubscribe(channel: string, listener: ListenerMetadata): void {
    const listeners = this.channels.get(channel);
    if (!listeners) return;

    listeners.delete(listener);

    // Clean up empty channels
    if (listeners.size === 0) {
      this.channels.delete(channel);
    }

    console.log(
      `[EventBroadcaster] Unsubscribed from channel: ${channel} (listeners: ${this.getListenerCount(channel)})`
    );
  }

  /**
   * Broadcast data to the listeners on a channel that may see this backend
   * @param channel - Channel name
   * @param data - Data to broadcast
   * @param backendId - Backend the event belongs to; listeners without
   *   access to it never receive the event
   */
  broadcast(channel: string, data: unknown, backendId: number): void {
    const listeners = this.channels.get(channel);
    if (!listeners || listeners.size === 0) {
      console.log(`[EventBroadcaster] No listeners for channel: ${channel}`);
      return;
    }

    const filteredListeners = Array.from(listeners).filter((listener) =>
      listener.allowedBackendIds.includes(backendId)
    );

    if (filteredListeners.length === 0) {
      console.log(
        `[EventBroadcaster] No authorized listeners for channel: ${channel}, backend: ${backendId}`
      );
      return;
    }

    console.log(
      `[EventBroadcaster] Broadcasting to channel: ${channel} ` +
        `(backend: ${backendId}, listeners: ${filteredListeners.length}/${listeners.size})`
    );

    filteredListeners.forEach((listener) => {
      try {
        listener.callback(data);
      } catch (error) {
        console.error(
          `[EventBroadcaster] Error in listener for channel ${channel}:`,
          error
        );
      }
    });
  }

  /**
   * Get number of active listeners for a channel
   * @param channel - Channel name
   * @returns Number of listeners
   */
  getListenerCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  /**
   * Get all active channels
   * @returns Array of channel names
   */
  getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get total listener count across all channels
   * @returns Total number of listeners
   */
  getTotalListenerCount(): number {
    let total = 0;
    this.channels.forEach((listeners) => {
      total += listeners.size;
    });
    return total;
  }
}

// Singleton instance
export const eventBroadcaster = new EventBroadcaster();
