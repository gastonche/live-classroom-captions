// Local PeerJS signalling server for end-to-end tests, so tests never touch the public one.
import { PeerServer } from 'peer';

const port = Number(process.env.PEER_PORT || 9123);
PeerServer({ port, path: '/lcc', allow_discovery: false });
console.log(`peer server on http://127.0.0.1:${port}/lcc`);
