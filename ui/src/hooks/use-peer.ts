import { Peer } from "@/lib/peer";
import { PeerProps } from "@/components/peer";
import * as React from "react";

const MAX_OFFER_RETRIES = 5;
const OFFER_RETRY_INTERVAL = 500;

export function usePeer(props: PeerProps): Peer {
  const { url, prompt, connect, onConnected, onDisconnected, localStream } =
    props;

  const [peerConnection, setPeerConnection] =
    React.useState<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = React.useState<MediaStream | null>(
    null
  );
  const [controlChannel, setControlChannel] = React.useState<RTCDataChannel | null>(null);

  const connectionStateTimeoutRef = React.useRef(null);

  const sendOffer = async (
    url: string,
    offer: RTCSessionDescriptionInit | RTCSessionDescription,
    retry: number = 0
  ): Promise<any> => {
    try {
      const response = await fetch("/api/offer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: url,
          prompt,
          offer,
        }),
      });

      if (!response.ok) {
        throw new Error(`offer HTTP error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (retry < MAX_OFFER_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, OFFER_RETRY_INTERVAL)
        );
        return sendOffer(url, offer, retry + 1);
      }
      throw error;
    }
  };

  const handleConnectionStateChange = (state: string) => {
    switch (state) {
      case "connected":
        onConnected();
        break;
      case "disconnected":
        onDisconnected();
        break;
      default:
        break;
    }
  };

  React.useEffect(() => {
    if (connect) {
      if (peerConnection) return;
      if (!localStream) return;

      const configuration = {
        iceServers: [
          {
            urls: ["stun:stun.l.google.com:19302"],
          },
        ],
      };

      const pc = new RTCPeerConnection(configuration);
      setPeerConnection(pc);

      pc.addTransceiver("video");

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      // Create control channel for both negotiation and control
      const channel = pc.createDataChannel("control");
      
      channel.onopen = () => {
        console.log("[usePeer] Control channel opened, readyState:", channel.readyState);
        setControlChannel(channel);
      };

      channel.onclose = () => {
        console.log("[usePeer] Control channel closed");
        setControlChannel(null);
      };

      channel.onerror = (error) => {
        console.error("Control channel error:", error);
      };

      channel.onmessage = (event) => {
        console.log("Received message on control channel:", event.data);
      };

      pc.ontrack = (event) => {
        if (event.track.kind == "video") {
          setRemoteStream(event.streams[0]);
        }
      };

      pc.onicecandidate = async (event) => {
        if (!event.candidate) {
          const answer = await sendOffer(url, pc.localDescription!);
          await pc.setRemoteDescription(answer);
        }
      };

      pc.onconnectionstatechange = (event) => {
        handleConnectionStateChange(pc.connectionState);
      };

      const createOffer = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
      };

      createOffer().catch(console.error);
    } else {
      if (connectionStateTimeoutRef.current) {
        clearTimeout(connectionStateTimeoutRef.current);
      }
      if (peerConnection) {
        peerConnection.close();
      }
      setControlChannel(null);
      setRemoteStream(null);
      setPeerConnection(null);
    }
  }, [connect, localStream]);

  return {
    peerConnection,
    remoteStream,
    controlChannel,
  };
}
