import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { verifyToken } from '../lib/jwt';
import { supabase } from '../lib/supabase';

interface AuthSocket extends Socket {
  userId?: string;
}

export function initChatServer(httpServer: HttpServer, clientOrigin: string) {
  const io = new SocketServer(httpServer, {
    cors: { origin: clientOrigin, credentials: true },
    path: '/chat',
  });

  io.use((socket: AuthSocket, next) => {
    const token: string =
      ((socket.handshake.auth as any)?.token as string) ||
      (socket.handshake.query?.token as string);

    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = verifyToken(token);
      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    console.log(`[chat] connected: ${socket.userId}`);

    socket.on('join_conversation', async ({ conversationId }: { conversationId: string }) => {
      const { data } = await supabase
        .from('conversations')
        .select('tenant_id, landlord_id')
        .eq('id', conversationId)
        .single();

      if (!data || (data.tenant_id !== socket.userId && data.landlord_id !== socket.userId)) {
        socket.emit('error', { message: 'Not authorized for this conversation' });
        return;
      }

      socket.join(`conv:${conversationId}`);
    });

    socket.on('send_message', async ({ conversationId, text }: { conversationId: string; text: string }) => {
      if (!text?.trim()) return;

      const { data: conv } = await supabase
        .from('conversations')
        .select('tenant_id, landlord_id')
        .eq('id', conversationId)
        .single();

      if (!conv || (conv.tenant_id !== socket.userId && conv.landlord_id !== socket.userId)) return;

      const now = new Date().toISOString();

      const { data: message, error } = await supabase
        .from('app_messages')
        .insert({
          conversation_id: conversationId,
          sender_id: socket.userId,
          body: text.trim(),
          delivered_at: now,
        })
        .select()
        .single();

      if (error || !message) {
        socket.emit('error', { message: 'Failed to send message' });
        return;
      }

      await supabase
        .from('conversations')
        .update({ last_message: text.trim(), last_message_at: now })
        .eq('id', conversationId);

      io.to(`conv:${conversationId}`).emit('new_message', {
        id: message.id,
        conversationId,
        senderId: message.sender_id,
        text: message.body,
        createdAt: message.created_at,
        deliveredAt: message.delivered_at,
        readAt: message.read_at,
      });
    });

    socket.on('mark_read', async ({ conversationId }: { conversationId: string }) => {
      const readAt = new Date().toISOString();

      await supabase
        .from('app_messages')
        .update({ read_at: readAt })
        .eq('conversation_id', conversationId)
        .neq('sender_id', socket.userId)
        .is('read_at', null);

      socket.to(`conv:${conversationId}`).emit('message_read', { conversationId, readAt });
    });

    socket.on('disconnect', () => {
      console.log(`[chat] disconnected: ${socket.userId}`);
    });
  });

  return io;
}
