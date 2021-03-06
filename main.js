import './style.css';

import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  //put  your firebase configurations here
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

//using firestore
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const peer_connection = new RTCPeerConnection(servers); //manages peer to peer connection
let outgoingStream = null; //local stream variable
let incomingStream = null; // remote  stream variable

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangup = document.getElementById('hangupButton');

// Setup media sources
webcamButton.onclick = async () => {
  outgoingStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  incomingStream = new MediaStream();

  // Push tracks from local stream to peer connection
  outgoingStream.getTracks().forEach((track) => {
    peer_connection.addTrack(track, outgoingStream);
  });

  // Pull tracks from remote stream, add to video stream
  peer_connection.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      incomingStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = outgoingStream;
  remoteVideo.srcObject = incomingStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

//  Creatingan offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  peer_connection.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await peer_connection.createOffer();
  await peer_connection.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!peer_connection.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      peer_connection.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        peer_connection.addIceCandidate(candidate);
      }
    });
  });

  hangup.disabled = false;
};

//  Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  peer_connection.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await peer_connection.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await peer_connection.createAnswer();
  await peer_connection.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === 'added') {
        let data = change.doc.data();
        peer_connection.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
};
