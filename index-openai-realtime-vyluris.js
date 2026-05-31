const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Version de secours SANS Claude / SANS OpenAI Realtime.
// Objectif : faire remarcher Giorgia immédiatement avec Twilio seul.
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE       = process.env.TWILIO_PHONE;
const TONY_PHONE         = process.env.TONY_PHONE;
const PORT              = process.env.PORT || 8080;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ─── STOCKAGE TEMPORAIRE ──────────────────────────────────────────────────────
const appelsEnCours = {};

// ─── OUTILS ───────────────────────────────────────────────────────────────────
function normaliserReponseSms(body) {
  const txt = (body || '').trim().toUpperCase();
  if (['OUI', 'O', 'OK', 'YES', 'Y'].includes(txt)) return 'OUI';
  if (['NON', 'N', 'NO'].includes(txt)) return 'NON';
  return 'NON';
}

function dire(element, texte) {
  element.say(
    {
      voice: 'Polly.Lea',
      language: 'fr-FR'
    },
    texte
  );
}

function repondreXml(res, twiml) {
  res.type('text/xml');
  res.send(twiml.toString());
}

// ─── TEST SANTÉ RAILWAY ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).send('✅ Giorgia VYLURIS fonctionne.');
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, service: 'giorgia-vyluris' });
});

// ─── 1. APPEL ENTRANT ─────────────────────────────────────────────────────────
app.post('/appel-entrant', (req, res) => {
  const callSid   = req.body.CallSid;
  const callerNum = req.body.From || 'Numéro inconnu';

  console.log(`📞 Appel entrant : ${callSid} depuis ${callerNum}`);

  appelsEnCours[callSid] = {
    callerNum,
    createdAt: Date.now(),
    decision: null,
    nom: '',
    motif: ''
  };

  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    language: 'fr-FR',
    speechTimeout: 'auto',
    action: `/nom-appelant?callSid=${encodeURIComponent(callSid)}`,
    method: 'POST',
    hints: "bonjour, je suis, c'est, société, agence, production, canal, rai, arte"
  });

  dire(gather,
    "Studio VYLURIS bonjour, Giorgia à l'appareil. Puis-je avoir votre nom et votre société, s'il vous plaît ?"
  );

  twiml.redirect({ method: 'POST' }, `/nom-appelant?callSid=${encodeURIComponent(callSid)}`);

  repondreXml(res, twiml);
});

// ─── 2. NOM DE L'APPELANT ─────────────────────────────────────────────────────
app.post('/nom-appelant', async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const speechResult = (req.body.SpeechResult || '').trim();

  const data = appelsEnCours[callSid] || {
    callerNum: req.body.From || 'Numéro inconnu',
    createdAt: Date.now(),
    decision: null
  };

  data.nom = speechResult || 'Nom non compris';
  appelsEnCours[callSid] = data;

  console.log(`👤 Nom / société : ${data.nom}`);

  const twiml = new twilio.twiml.VoiceResponse();

  const gather = twiml.gather({
    input: 'speech',
    language: 'fr-FR',
    speechTimeout: 'auto',
    action: `/motif-appel?callSid=${encodeURIComponent(callSid)}`,
    method: 'POST',
    hints: "rendez-vous, proposition, collaboration, coproduction, film, série, devis, message"
  });

  dire(gather,
    "Merci. Pouvez-vous me dire brièvement le motif de votre appel ?"
  );

  twiml.redirect({ method: 'POST' }, `/motif-appel?callSid=${encodeURIComponent(callSid)}`);

  repondreXml(res, twiml);
});

// ─── 3. MOTIF DE L'APPEL + SMS À TONY ─────────────────────────────────────────
app.post('/motif-appel', async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const speechResult = (req.body.SpeechResult || '').trim();

  const data = appelsEnCours[callSid] || {
    callerNum: req.body.From || 'Numéro inconnu',
    createdAt: Date.now(),
    decision: null,
    nom: 'Appelant'
  };

  data.motif = speechResult || 'Motif non compris';
  data.decision = null;
  appelsEnCours[callSid] = data;

  console.log(`📝 Motif : ${data.motif}`);

  try {
    await client.messages.create({
      body:
`📞 VYLURIS — Appel entrant

Nom / société : ${data.nom}
Téléphone : ${data.callerNum}
Motif : ${data.motif}

Réponds OUI pour transférer.
Réponds NON pour décliner.`,
      from: TWILIO_PHONE,
      to: TONY_PHONE
    });
    console.log('✅ SMS envoyé à Tony');
  } catch (err) {
    console.error('❌ Erreur SMS à Tony:', err.message);
  }

  const twiml = new twilio.twiml.VoiceResponse();

  dire(twiml,
    "Très bien, je vérifie la disponibilité de Monsieur Calderini. Merci de patienter un instant."
  );

  twiml.pause({ length: 15 });
  twiml.redirect({ method: 'POST' }, `/verifier-reponse?callSid=${encodeURIComponent(callSid)}`);

  repondreXml(res, twiml);
});

// ─── 4. RÉPONSE SMS DE TONY ───────────────────────────────────────────────────
app.post('/sms-reponse', (req, res) => {
  const body = req.body.Body || '';
  const decision = normaliserReponseSms(body);

  console.log(`📩 Réponse SMS Tony : ${body} => ${decision}`);

  // On applique à l'appel actif le plus récent sans décision.
  const appels = Object.entries(appelsEnCours)
    .filter(([_, data]) => !data.decision)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));

  if (appels.length > 0) {
    const [callSid, data] = appels[0];
    data.decision = decision;
    appelsEnCours[callSid] = data;
    console.log(`✅ Décision appliquée à ${callSid}: ${decision}`);
  } else {
    console.log('⚠️ Aucun appel en attente de décision');
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(
    decision === 'OUI'
      ? '✅ Giorgia transfère l’appel.'
      : '❌ Giorgia va proposer de prendre un message.'
  );

  repondreXml(res, twiml);
});

// ─── 5. VÉRIFICATION DÉCISION ────────────────────────────────────────────────
app.post('/verifier-reponse', (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const data = appelsEnCours[callSid];

  const twiml = new twilio.twiml.VoiceResponse();

  if (!data) {
    dire(twiml,
      "Je suis désolée, une erreur technique est survenue. Merci de rappeler le Studio VYLURIS un peu plus tard."
    );
    return repondreXml(res, twiml);
  }

  if (data.decision === 'OUI') {
    console.log(`🔁 Transfert vers Tony pour ${callSid}`);

    dire(twiml,
      "Je vous transfère maintenant vers Monsieur Calderini. Un instant s'il vous plaît."
    );

    twiml.dial({
      callerId: TWILIO_PHONE,
      timeout: 25
    }, TONY_PHONE);

    delete appelsEnCours[callSid];
    return repondreXml(res, twiml);
  }

  if (data.decision === 'NON') {
    console.log(`📝 Appel décliné, prise de message pour ${callSid}`);

    const gather = twiml.gather({
      input: 'speech',
      language: 'fr-FR',
      speechTimeout: 'auto',
      action: `/prendre-message?callSid=${encodeURIComponent(callSid)}`,
      method: 'POST'
    });

    dire(gather,
      "Monsieur Calderini n'est pas disponible pour le moment. Vous pouvez me laisser un court message, je le lui transmettrai."
    );

    twiml.redirect({ method: 'POST' }, `/prendre-message?callSid=${encodeURIComponent(callSid)}`);

    return repondreXml(res, twiml);
  }

  // Pas encore de réponse de Tony : on attend.
  dire(twiml,
    "Merci de patienter, je vérifie encore sa disponibilité."
  );
  twiml.pause({ length: 15 });
  twiml.redirect({ method: 'POST' }, `/verifier-reponse?callSid=${encodeURIComponent(callSid)}`);

  repondreXml(res, twiml);
});

// ─── 6. PRISE DE MESSAGE ─────────────────────────────────────────────────────
app.post('/prendre-message', async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const speechResult = (req.body.SpeechResult || '').trim();

  const data = appelsEnCours[callSid] || {
    callerNum: 'Numéro inconnu',
    nom: 'Appelant',
    motif: 'Motif non indiqué'
  };

  if (speechResult) {
    try {
      await client.messages.create({
        body:
`📝 Message VYLURIS

Nom / société : ${data.nom}
Téléphone : ${data.callerNum}
Motif initial : ${data.motif}

Message :
"${speechResult}"`,
        from: TWILIO_PHONE,
        to: TONY_PHONE
      });
      console.log('✅ Message vocal transcrit envoyé par SMS');
    } catch (err) {
      console.error('❌ Erreur SMS message:', err.message);
    }
  }

  const twiml = new twilio.twiml.VoiceResponse();

  dire(twiml,
    "Merci, votre message a bien été transmis. Le Studio VYLURIS vous souhaite une excellente journée."
  );

  delete appelsEnCours[callSid];

  repondreXml(res, twiml);
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Giorgia VYLURIS — version secours Twilio démarrée sur le port ${PORT}`);
});
