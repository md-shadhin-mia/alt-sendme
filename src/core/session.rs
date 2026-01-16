use anyhow::{Context, Result};
use iroh::protocol::{Handler, ProtocolHandler};
use iroh_blobs::util::RpcError;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::core::types::AppHandle;

/// ALPN identifier for the session protocol
pub const SESSION_ALPN: &[u8] = b"sendme/session/1";

/// Messages exchanged in a session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionMessage {
    /// Text message
    Text { content: String },
    /// File offer with metadata
    FileOffer {
        name: String,
        size: u64,
        hash: String,
    },
    /// Accept file offer
    FileAccept { hash: String },
    /// WebRTC signaling data
    CallSignal { signal_type: String, data: String },
}

impl SessionMessage {
    /// Serialize message to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).context("Failed to serialize session message")
    }

    /// Deserialize message from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        serde_json::from_slice(bytes).context("Failed to deserialize session message")
    }
}

/// Session state shared between handler and commands
pub struct SessionState {
    pub app_handle: AppHandle,
    pub peer_id: Option<iroh::NodeId>,
    pub connection: Option<Arc<Mutex<iroh::endpoint::Connection>>>,
}

impl SessionState {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            peer_id: None,
            connection: None,
        }
    }

    /// Send a message to the peer
    pub async fn send_message(&self, message: SessionMessage) -> Result<()> {
        let conn = self
            .connection
            .as_ref()
            .context("No active connection")?
            .lock()
            .await;

        let mut send_stream = conn
            .open_uni()
            .await
            .context("Failed to open send stream")?;

        let bytes = message.to_bytes()?;
        let len = bytes.len() as u32;

        // Send length prefix
        send_stream
            .write_all(&len.to_be_bytes())
            .await
            .context("Failed to write message length")?;

        // Send message
        send_stream
            .write_all(&bytes)
            .await
            .context("Failed to write message")?;

        send_stream
            .finish()
            .await
            .context("Failed to finish stream")?;

        debug!("Sent session message: {:?}", message);
        Ok(())
    }

    /// Emit event to frontend
    fn emit_event(&self, event_name: &str, payload: &str) {
        if let Some(handle) = &self.app_handle {
            if let Err(e) = handle.emit_event_with_payload(event_name, payload) {
                warn!("Failed to emit event {}: {}", event_name, e);
            }
        }
    }
}

/// Session protocol handler
pub struct SessionHandler {
    state: Arc<Mutex<SessionState>>,
}

impl SessionHandler {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            state: Arc::new(Mutex::new(SessionState::new(app_handle))),
        }
    }

    pub fn get_state(&self) -> Arc<Mutex<SessionState>> {
        self.state.clone()
    }

    /// Handle incoming unidirectional stream
    async fn handle_uni_stream(
        state: Arc<Mutex<SessionState>>,
        mut recv_stream: iroh::endpoint::RecvStream,
    ) -> Result<()> {
        // Read length prefix
        let mut len_bytes = [0u8; 4];
        recv_stream
            .read_exact(&mut len_bytes)
            .await
            .context("Failed to read message length")?;
        let len = u32::from_be_bytes(len_bytes) as usize;

        // Validate length
        if len > 10 * 1024 * 1024 {
            // 10MB max
            anyhow::bail!("Message too large: {} bytes", len);
        }

        // Read message
        let mut buffer = vec![0u8; len];
        recv_stream
            .read_exact(&mut buffer)
            .await
            .context("Failed to read message")?;

        let message = SessionMessage::from_bytes(&buffer)?;
        debug!("Received session message: {:?}", message);

        // Handle message
        let state_lock = state.lock().await;
        match &message {
            SessionMessage::Text { content } => {
                let payload = serde_json::json!({
                    "type": "text",
                    "content": content
                })
                .to_string();
                state_lock.emit_event("session-message", &payload);
            }
            SessionMessage::FileOffer { name, size, hash } => {
                let payload = serde_json::json!({
                    "type": "file_offer",
                    "name": name,
                    "size": size,
                    "hash": hash
                })
                .to_string();
                state_lock.emit_event("session-message", &payload);
            }
            SessionMessage::FileAccept { hash } => {
                let payload = serde_json::json!({
                    "type": "file_accept",
                    "hash": hash
                })
                .to_string();
                state_lock.emit_event("session-message", &payload);
            }
            SessionMessage::CallSignal { signal_type, data } => {
                let payload = serde_json::json!({
                    "type": "call_signal",
                    "signal_type": signal_type,
                    "data": data
                })
                .to_string();
                state_lock.emit_event("session-message", &payload);
            }
        }

        Ok(())
    }
}

impl ProtocolHandler for SessionHandler {
    fn accept(
        self: Arc<Self>,
        conn: iroh::endpoint::Connection,
    ) -> impl std::future::Future<Output = Result<(), RpcError>> + Send + 'static {
        async move {
            info!("Session connection accepted from {}", conn.remote_address());

            // Store connection
            {
                let mut state = self.state.lock().await;
                state.peer_id = Some(conn.remote_node_id().expect("peer id"));
                state.connection = Some(Arc::new(Mutex::new(conn.clone())));
                
                // Notify frontend
                if let Some(handle) = &state.app_handle {
                    let _ = handle.emit_event("session-connected");
                }
            }

            // Handle incoming streams
            loop {
                tokio::select! {
                    stream = conn.accept_uni() => {
                        match stream {
                            Ok(recv_stream) => {
                                let state = self.state.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = Self::handle_uni_stream(state, recv_stream).await {
                                        error!("Error handling stream: {}", e);
                                    }
                                });
                            }
                            Err(e) => {
                                warn!("Error accepting stream: {}", e);
                                break;
                            }
                        }
                    }
                }
            }

            info!("Session connection closed");
            Ok(())
        }
    }
}

/// Start a session as the initiator (connects to a ticket)
pub async fn connect_session(
    ticket: String,
    app_handle: AppHandle,
) -> Result<Arc<Mutex<SessionState>>> {
    info!("Connecting to session with ticket");

    // Parse ticket
    let ticket: iroh_blobs::ticket::BlobTicket = ticket
        .parse()
        .context("Failed to parse session ticket")?;

    let node_addr = ticket.node_addr().clone();

    // Create endpoint
    let secret_key = crate::core::types::get_or_create_secret()?;
    let endpoint = iroh::Endpoint::builder()
        .alpns(vec![SESSION_ALPN.to_vec()])
        .secret_key(secret_key)
        .relay_mode(iroh::RelayMode::Default)
        .bind()
        .await
        .context("Failed to bind endpoint")?;

    // Connect to peer
    let conn = endpoint
        .connect(node_addr, SESSION_ALPN)
        .await
        .context("Failed to connect to peer")?;

    info!("Connected to session peer");

    // Create session state
    let state = Arc::new(Mutex::new(SessionState::new(app_handle.clone())));
    {
        let mut state_lock = state.lock().await;
        state_lock.peer_id = Some(conn.remote_node_id().expect("peer id"));
        state_lock.connection = Some(Arc::new(Mutex::new(conn.clone())));
        
        // Notify frontend
        if let Some(handle) = &state_lock.app_handle {
            let _ = handle.emit_event("session-connected");
        }
    }

    // Spawn task to handle incoming streams
    let state_clone = state.clone();
    tokio::spawn(async move {
        loop {
            match conn.accept_uni().await {
                Ok(recv_stream) => {
                    let state = state_clone.clone();
                    tokio::spawn(async move {
                        if let Err(e) = SessionHandler::handle_uni_stream(state, recv_stream).await
                        {
                            error!("Error handling stream: {}", e);
                        }
                    });
                }
                Err(e) => {
                    warn!("Error accepting stream: {}", e);
                    break;
                }
            }
        }
    });

    Ok(state)
}
