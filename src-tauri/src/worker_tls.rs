use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, ServerName},
    ClientConfig, ClientConnection, RootCertStore, ServerConfig, ServerConnection, StreamOwned,
};
use std::{
    io::{self, Read, Write},
    net::{Ipv4Addr, TcpStream},
    sync::Arc,
    time::Duration,
};

pub enum Stream {
    Client(StreamOwned<ClientConnection, TcpStream>),
    Server(StreamOwned<ServerConnection, TcpStream>),
}
pub fn server_config() -> Result<(Arc<ServerConfig>, Vec<u8>), String> {
    let identity =
        rcgen::generate_simple_self_signed(vec!["localhost".into()]).map_err(|e| e.to_string())?;
    let certificate = identity.cert.der().to_vec();
    let private_key = PrivateKeyDer::Pkcs8(identity.key_pair.serialize_der().into());
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![CertificateDer::from(certificate.clone())], private_key)
        .map_err(|e| e.to_string())?;
    Ok((Arc::new(config), certificate))
}
impl Stream {
    pub fn connect(port: u16, certificate: Vec<u8>) -> io::Result<Self> {
        let mut roots = RootCertStore::empty();
        roots
            .add(CertificateDer::from(certificate))
            .map_err(io::Error::other)?;
        let config = ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let mut connection = ClientConnection::new(
            Arc::new(config),
            ServerName::try_from("localhost").unwrap().to_owned(),
        )
        .map_err(io::Error::other)?;
        let mut socket = TcpStream::connect((Ipv4Addr::LOCALHOST, port))?;
        socket.set_read_timeout(Some(Duration::from_secs(5)))?;
        socket.set_write_timeout(Some(Duration::from_secs(5)))?;
        // Pin the worker's protected certificate before sending any RPC credential or passphrase.
        while connection.is_handshaking() {
            connection.complete_io(&mut socket)?;
        }
        socket.set_read_timeout(None)?;
        Ok(Self::Client(StreamOwned::new(connection, socket)))
    }
    pub fn server(socket: TcpStream, config: Arc<ServerConfig>) -> io::Result<Self> {
        socket.set_nonblocking(false)?;
        Ok(Self::Server(StreamOwned::new(
            ServerConnection::new(config).map_err(io::Error::other)?,
            socket,
        )))
    }
    pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        match self {
            Self::Client(stream) => stream.sock.set_read_timeout(timeout),
            Self::Server(stream) => stream.sock.set_read_timeout(timeout),
        }
    }
    pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        match self {
            Self::Client(stream) => stream.sock.set_write_timeout(timeout),
            Self::Server(stream) => stream.sock.set_write_timeout(timeout),
        }
    }
}
impl Read for Stream {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Client(stream) => stream.read(bytes),
            Self::Server(stream) => stream.read(bytes),
        }
    }
}
impl Write for Stream {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self {
            Self::Client(stream) => stream.write(bytes),
            Self::Server(stream) => stream.write(bytes),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Client(stream) => stream.flush(),
            Self::Server(stream) => stream.flush(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pinned_tls_transport_exchanges_data_and_rejects_an_impostor() {
        for trusted in [true, false] {
            let (config, certificate) = server_config().unwrap();
            let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = listener.local_addr().unwrap().port();
            let server = std::thread::spawn(move || {
                let mut stream = Stream::server(listener.accept().unwrap().0, config).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = [0u8; 5];
                if trusted {
                    stream.read_exact(&mut bytes).unwrap();
                    assert_eq!(&bytes, b"hello");
                    stream.write_all(b"world").unwrap();
                    stream.flush().unwrap();
                } else {
                    assert!(stream.read_exact(&mut bytes).is_err());
                }
            });
            let pin = if trusted {
                certificate
            } else {
                server_config().unwrap().1
            };
            if trusted {
                let mut client = Stream::connect(port, pin).unwrap();
                client.write_all(b"hello").unwrap();
                client.flush().unwrap();
                let mut bytes = [0u8; 5];
                client.read_exact(&mut bytes).unwrap();
                assert_eq!(&bytes, b"world");
            } else {
                assert!(Stream::connect(port, pin).is_err());
            }
            server.join().unwrap();
        }
    }
}
