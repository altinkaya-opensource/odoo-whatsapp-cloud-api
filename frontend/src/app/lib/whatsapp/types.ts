export type AttachmentType = "image" | "video" | "audio" | "document";

export type Attachment = {
  id: number;
  name: string;
  mimetype: string;
  url: string;
  file_size: number;
  type?: AttachmentType;
};

export type Message = {
  id?: string;
  contactId: string;
  message: string;
  timestamp: number;
  isSentFromUser: boolean;
  read?: boolean;
  sent?: boolean;
  delivered?: boolean;
  error?: string;
  userId?: number | null;
  whatsappId?: string | null;
  attachment?: Attachment;
  reactionEmoji?: string | null;
  /** Odoo id of the quoted message, resolved into replyTo when loaded */
  replyMessageId?: string | null;
  replyTo?: {
    messageId: string;
    message: string;
    contactId: string;
    senderIsUser: boolean;
  };
};

export type Chat = {
  id: string;
  threadName?: string;
  phoneNumber?: string | null;
  backendId?: number | null;
  partnerId?: number | null; // Partner ID for opening in Odoo
  partnerName?: string | null; // Partner display name from Odoo
  partnerAvatar?: string | null; // Partner avatar URL from Odoo
  hasAvatar?: boolean; // Partner has a real avatar, not a generated one
  lastMessagePreview?: string;
  lastMessageAt?: number | null;
  unreadCount?: number;
  read: boolean;
};

export type MessageSearchResult = {
  threadId: number;
  threadName: string;
  phoneNumber: string | null;
  backendId: number | null;
  partnerId: number | null;
  partnerName: string | null;
  messageId: number;
  messageBody: string;
  messageTimestamp: number;
};
