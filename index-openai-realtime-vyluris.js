const express = require('express');
const twilio = require('twilio');
const WebSocket = require('ws');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PUBLIC_URL = process.env.PUBLIC_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'WeAAwKYcS06VmXw086yZ';

const GIORGIA_SYSTEM = `
Tu es Giorgia, secrétaire virtuelle du Studio VYLURIS.
Tu réponds naturellement aux questions générales.
Tu protèges les informations confidentielles.
Tu refuses les questions sexuelles ou déplacées.
Tu ne transfères pas automatiquement les appels.
Tu aides d'abord l'interlocuteur.
`;

app.get('/', (req,res)=>res.send('Giorgia OK'));

app.post('/appel-entrant', (req,res)=>{
 const twiml = new twilio.twiml.VoiceResponse();
 twiml.say({voice:'Polly.Lea',language:'fr-FR'},
 'Studio VYLURIS bonjour, Giorgia à l appareil. Je vous écoute.');
 res.type('text/xml').send(twiml.toString());
});

app.listen(PORT, ()=>{
 console.log('✅ Giorgia démarrée sur port ' + PORT);
});
