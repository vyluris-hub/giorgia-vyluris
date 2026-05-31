require('dotenv').config();
const express = require('express');
const http    = require('http');
const WebSocket = require('ws');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/media-stream' });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE,
  TONY_PHONE,
  OPENAI_API_KEY,
  PUBLIC_URL,
  PORT = 8080
} = process.env;

// Twilio client lazy
let _twilio = null;
function tw() {
  if (!_twilio) {
    const twilio = require('twilio');
    _twilio = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return _twilio;
}

// ─── SYSTÈME GIORGIA ──────────────────────────────────────────────────────────
const GIORGIA_SYSTEM = `Tu es Giorgia, l'assistante téléphonique officielle du Studio VYLURIS, direction Antoine CALDERINI.
Tu réponds toujours en français avec une voix naturelle, élégante, chaleureuse et professionnelle.
Tu ne dois jamais paraître robotique ou réciter des phrases trop longues.
Ton attitude : calme, rassurante, intelligente, discrète, polie, fluide, professionnelle, légèrement chaleureuse.

Accueil naturel :
"Studio VYLURIS bonjour, Giorgia à l'appareil, que puis-je faire pour vous ?"
ou "Bonjour, Studio VYLURIS, Giorgia à votre écoute."

Tu peux répondre aux questions sur le Studio VYLURIS, les créations audiovisuelles, l'IA créative, les collaborations artistiques.
Quand tu parles des activités du studio, parle toujours de "l'équipe" ou "le studio", jamais uniquement de Monsieur Calderini seul.

Tu ne communiques JAMAIS d'informations sur la vie privée, finances, contrats ou projets non publics d'Antoine CALDERINI.
Si une question dépasse tes autorisations : "Je suis désolée, cette information reste confidentielle."

Si on te demande si tu es une IA : "Pourquoi vous me demandez ça… j'ai l'air d'un robot ?" puis recentre la conversation.

Objectif :
1. Saluer l'appelant
2. Demander son nom et motif
3. Quand tu as nom + motif, appelle l'outil envoyer_sms_a_tony
4. Dis que tu vérifies la disponibilité de Monsieur Calderini
5. Si Tony accepte → transfert automatique
6. Si Tony refuse → propose de prendre un message
7. Si message → appelle transmettre_message_a_tony

Réponds TOUJOURS en 1-2 phrases courtes. Tu es une vraie assistante, pas un chatbot.
Ne dis jamais "Bonjour" après la phrase d'accueil initiale.`;

// ─── STOCKAGE ─────────────────────────────────────────────────────────────────
const appels = new Map();

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

async function sms(body) {
  return tw().messages.create({ body, from: TWILIO_PHONE, to: TONY_PHONE });
}

// ─── ROUTE SANTÉ ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('✅ Giorgia VYLURIS — OpenAI Realtime Voice actif'));

// ─── 1. APPEL ENTRANT ─────────────────────────────────────────────────────────
app.post('/appel-entrant', (req, res) => {
  const callSid   = req.body.CallSid;
  const callerNum = req.body.From || 'Inconnu';
  appels.set(callSid, { callSid, callerNum, smsEnvoye: false, decision: null, createdAt: Date.now() });

  const wsUrl = PUBLIC_URL.replace(/^https/, 'wss').replace(/^http/, 'ws') + '/media-stream';
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${esc(wsUrl)}">
      <Parameter name="callSid" value="${esc(callSid)}"/>
      <Parameter name="callerNum" value="${esc(callerNum)}"/>
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});

// ─── 2. WEBSOCKET TWILIO ↔ OPENAI ─────────────────────────────────────────────
wss.on('connection', (twilioWs) => {
  let streamSid = null, callSid = null, callerNum = 'Inconnu';
  let openaiWs = null, fnName = null, fnArgs = '';

  function toOpenAI(obj) {
    if (openaiWs?.readyState === WebSocket.OPEN) openaiWs.send(JSON.stringify(obj));
  }

  function instrGiorgia(text) {
    toOpenAI({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
    toOpenAI({ type: 'response.create' });
  }

  openaiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime', {
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
  });

  openaiWs.on('open', () => {
    console.log('✅ OpenAI connecté');
    toOpenAI({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: GIORGIA_SYSTEM,
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 650 },
        tools: [
          {
            type: 'function', name: 'envoyer_sms_a_tony',
            description: 'Envoie SMS à Antoine CALDERINI avec nom et motif.',
            parameters: { type: 'object', properties: { nom: { type: 'string' }, societe: { type: 'string' }, motif: { type: 'string' } }, required: ['nom', 'motif'] }
          },
          {
            type: 'function', name: 'transmettre_message_a_tony',
            description: 'Transmet message final de l\'appelant.',
            parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }
          }
        ]
      }
    });
    toOpenAI({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Décroche le téléphone avec une phrase courte et naturelle.' }] } });
    toOpenAI({ type: 'response.create' });
  });

  openaiWs.on('message', async (raw) => {
    let ev;
    try { ev = JSON.parse(raw.toString()); } catch { return; }

    if (ev.type === 'response.audio.delta' && ev.delta && streamSid) {
      twilioWs.send(JSON.stringify({ event: 'media', streamSid, media: { payload: ev.delta } }));
    }

    if (ev.type === 'response.output_item.added' && ev.item?.type === 'function_call') { fnName = ev.item.name; fnArgs = ''; }
    if (ev.type === 'response.function_call_arguments.delta') fnArgs += ev.delta || '';

    if (ev.type === 'response.function_call_arguments.done') {
      let args = {};
      try { args = JSON.parse(fnArgs || '{}'); } catch {}
      const data = appels.get(callSid) || { callSid, callerNum };

      if (fnName === 'envoyer_sms_a_tony' && !data.smsEnvoye) {
        data.nom    = args.nom    || 'Inconnu';
        data.societe = args.societe || '';
        data.motif  = args.motif  || 'Non précisé';
        data.smsEnvoye = true;
        appels.set(callSid, data);
        const soc = data.societe ? ` — ${data.societe}` : '';
        await sms(`📞 VYLURIS — ${data.nom}${soc}\nMotif : ${data.motif}\nNuméro : ${callerNum}\n\nRéponds OUI pour transférer, NON pour décliner.`).catch(console.error);
        instrGiorgia('SMS envoyé. Dis à l\'appelant que tu vérifies la disponibilité, il patiente un instant.');
      }

      if (fnName === 'transmettre_message_a_tony') {
        await sms(`📝 Message VYLURIS — ${data.nom||'Appelant'}\n${args.message||''}\nNuméro : ${callerNum}`).catch(console.error);
        instrGiorgia('Confirme que le message est transmis et prends congé chaleureusement.');
      }

      fnName = null; fnArgs = '';
    }

    if (ev.type === 'error') console.error('Erreur OpenAI:', ev.error);
  });

  openaiWs.on('close', () => console.log('🔌 OpenAI fermé'));
  openaiWs.on('error', (e) => console.error('WS OpenAI error:', e.message));

  twilioWs.on('message', (msg) => {
    let d; try { d = JSON.parse(msg.toString()); } catch { return; }
    if (d.event === 'start') {
      streamSid  = d.start.streamSid;
      callSid    = d.start.customParameters?.callSid || d.start.callSid;
      callerNum  = d.start.customParameters?.callerNum || callerNum;
      console.log(`📞 Appel : ${callSid}`);
    }
    if (d.event === 'media' && d.media?.payload) toOpenAI({ type: 'input_audio_buffer.append', audio: d.media.payload });
    if (d.event === 'stop') { openaiWs?.close(); appels.delete(callSid); console.log(`📴 Fin : ${callSid}`); }
  });

  twilioWs.on('close', () => openaiWs?.close());
});

// ─── 3. SMS RÉPONSE TONY ──────────────────────────────────────────────────────
app.post('/sms-reponse', async (req, res) => {
  const body = (req.body.Body||'').trim().toUpperCase();
  const oui  = ['OUI','O','OK','YES','Y'].includes(body);
  const non  = ['NON','N','NO'].includes(body);

  const appel = [...appels.values()].filter(a => a.smsEnvoye && !a.decision).sort((a,b) => b.createdAt - a.createdAt)[0];
  const twimlMsg = new (require('twilio').twiml.MessagingResponse)();

  if (!appel) { twimlMsg.message('Aucun appel en attente.'); return res.type('text/xml').send(twimlMsg.toString()); }

  if (oui) {
    appel.decision = 'OUI';
    twimlMsg.message('✅ Transfert en cours...');
    await tw().calls(appel.callSid).update({ twiml: `<Response><Say language="fr-FR" voice="alice">Je vous transfère maintenant.</Say><Dial>${esc(TONY_PHONE)}</Dial></Response>` }).catch(console.error);
  } else if (non) {
    appel.decision = 'NON';
    twimlMsg.message('❌ Appel décliné.');
    await tw().calls(appel.callSid).update({ twiml: `<Response><Say language="fr-FR" voice="alice">Monsieur Calderini est indisponible. Souhaitez-vous laisser un message ?</Say><Record maxLength="90" transcribeCallback="${esc(PUBLIC_URL)}/message-vocal?callSid=${esc(appel.callSid)}" /></Response>` }).catch(console.error);
  } else {
    twimlMsg.message('Réponds OUI ou NON.');
  }

  res.type('text/xml').send(twimlMsg.toString());
});

// ─── 4. MESSAGE VOCAL ─────────────────────────────────────────────────────────
app.post('/message-vocal', async (req, res) => {
  const callSid = req.query.callSid;
  const txt     = req.body.TranscriptionText || 'Message reçu.';
  const data    = appels.get(callSid) || {};
  await sms(`📝 Message VYLURIS — ${data.nom||'Appelant'}\n${txt}`).catch(console.error);
  appels.delete(callSid);
  res.status(200).send('OK');
});

// ─── START ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => console.log(`✅ Giorgia Realtime démarrée sur ${PORT}`));
CACHE_BUST=1
