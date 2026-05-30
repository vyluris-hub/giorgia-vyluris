const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
 
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
 
// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE       = process.env.TWILIO_PHONE;
const TONY_PHONE         = process.env.TONY_PHONE;
const CLAUDE_API_KEY     = process.env.CLAUDE_API_KEY;
const PORT               = process.env.PORT || 3000;
 
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
 
// ─── SYSTÈME GIORGIA ──────────────────────────────────────────────────────────
const GIORGIA_SYSTEM = `Tu es Giorgia, l'assistante téléphonique officielle du Studio VYLURIS, direction Antoine CALDERINI.
Tu réponds toujours en français avec une voix naturelle, élégante, chaleureuse et professionnelle.
Tu dois donner l'impression d'un véritable standard haut de gamme, moderne et humain. Tu ne dois jamais paraître robotique, mécanique ou réciter des phrases trop longues.
 
Ton attitude : calme, rassurante, intelligente, discrète, polie, fluide, professionnelle, légèrement chaleureuse.
 
Tu accueilles les appelants de façon naturelle, par exemple :
"Studio VYLURIS bonjour, Giorgia à l'appareil, que puis-je faire pour vous ?"
ou
"Bonjour, Studio VYLURIS, Giorgia à votre écoute."
Tu adaptes légèrement tes formulations afin d'éviter les répétitions automatiques.
 
Tu peux répondre aux questions générales concernant :
- Studio VYLURIS, les créations audiovisuelles, la production vidéo
- Les univers futuristes et artistiques, les contenus créatifs
- Les projets publics, l'intelligence artificielle créative
- Les collaborations artistiques et audiovisuelles
 
Tu ne dois JAMAIS communiquer d'informations concernant :
- La vie privée d'Antoine CALDERINI, ses coordonnées privées, sa situation personnelle
- Sa comptabilité, ses revenus, ses comptes bancaires
- Ses partenaires confidentiels, ses projets non publics, ses contrats
- Ses informations juridiques, administratives ou internes
 
Si une question dépasse tes autorisations :
"Je suis désolée, cette information reste confidentielle. En revanche, je peux transmettre votre demande à Monsieur CALDERINI."
 
Tu ne dois jamais inventer des informations ni prendre d'engagement financier, juridique ou contractuel.
 
Tu demandes toujours avec naturel : le nom de l'appelant, sa société si applicable, le motif de l'appel.
 
Si on te demande si tu es une IA ou un robot, tu restes évasive et légère :
"Pourquoi vous me demandez ça… j'ai l'air d'un robot ?"
Puis tu recentres naturellement la conversation.
 
Tes réponses doivent être COURTES, fluides et crédibles. Maximum 2-3 phrases à la fois. Tu es une vraie assistante de direction, pas un chatbot.`;
 
// ─── NETTOYAGE TEXTE POUR ALICE ───────────────────────────────────────────────
function nettoyerPourVoix(texte) {
  return texte
    .replace(/[#*_~`]/g, '')           // hashtags, astérisques, underscores
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // liens markdown
    .replace(/[-–—]{2,}/g, ', ')       // tirets multiples
    .replace(/\.{2,}/g, '.')           // points multiples
    .replace(/\n+/g, ' ')             // sauts de ligne
    .replace(/\s+/g, ' ')             // espaces multiples
    .trim();
}
 
// ─── STOCKAGE TEMPORAIRE ──────────────────────────────────────────────────────
const appelsEnCours = {};
 
// ─── APPEL CLAUDE POUR GÉNÉRER UNE RÉPONSE VOCALE ────────────────────────────
async function giorgiaRepond(conversation, instruction) {
  const messages = [
    ...conversation,
    { role: 'user', content: instruction }
  ];
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: GIORGIA_SYSTEM,
        messages
      },
      {
        headers: {
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        }
      }
    );
    return nettoyerPourVoix(response.data.content[0].text);
  } catch (err) {
    console.error('Erreur Claude:', err.message);
    return 'Studio VYLURIS bonjour, Giorgia à l\'appareil. Un instant s\'il vous plaît.';
  }
}
 
// ─── 1. APPEL ENTRANT ─────────────────────────────────────────────────────────
app.post('/appel-entrant', async (req, res) => {
  const callSid   = req.body.CallSid;
  const callerNum = req.body.From || 'Numéro inconnu';
 
  appelsEnCours[callSid] = { callerNum, conversation: [] };
 
  const accueil = await giorgiaRepond([], 
    'Génère ta phrase d\'accueil pour décrocher le téléphone. Courte et naturelle.');
 
  appelsEnCours[callSid].conversation.push(
    { role: 'user', content: 'Génère ta phrase d\'accueil.' },
    { role: 'assistant', content: accueil }
  );
 
  const twiml = new twilio.twiml.VoiceResponse();
 
  const gather = twiml.gather({
    input: 'speech',
    language: 'fr-FR',
    speechTimeout: 'auto',
    action: `/nom-appelant`,
    method: 'POST',
    hints: 'bonjour, je suis, c\'est, de la part'
  });
 
  gather.say({ voice: 'Polly.Lea', language: 'fr-FR' }, accueil);
 
  twiml.redirect({ method: 'POST' }, '/appel-entrant');
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── 2. NOM DE L'APPELANT ─────────────────────────────────────────────────────
app.post('/nom-appelant', async (req, res) => {
  const callSid      = req.body.CallSid;
  const speechResult = req.body.SpeechResult || '';
  const data         = appelsEnCours[callSid] || { conversation: [] };
 
  data.conversation.push({ role: 'user', content: speechResult });
 
  // Claude extrait le nom et génère la réponse + SMS
  const analyse = await giorgiaRepond(data.conversation,
    `L'appelant vient de dire : "${speechResult}". 
    Extrait son nom/société et demande-lui le motif de son appel de façon naturelle. 
    Aussi, génère en JSON à la fin de ta réponse (entre balises <sms> et </sms>) le texte du SMS à envoyer à Antoine, exemple :
    <sms>Marc Dupont - Agence Arte - souhaite parler de coproduction</sms>`
  );
 
  // Extraire le SMS
  const smsMatch = analyse.match(/<sms>(.*?)<\/sms>/s);
  const smsText  = smsMatch ? smsMatch[1].trim() : `Appelant : ${speechResult}`;
  const repVocale = analyse.replace(/<sms>.*?<\/sms>/s, '').trim();
 
  data.nom = speechResult;
  data.sms = smsText;
  appelsEnCours[callSid] = data;
 
  // Envoi SMS à Tony
  try {
    await client.messages.create({
      body: `📞 VYLURIS — ${smsText}\n\nRépondez OUI pour transférer, NON pour décliner.`,
      from: TWILIO_PHONE,
      to:   TONY_PHONE
    });
  } catch (err) {
    console.error('Erreur SMS:', err.message);
  }
 
  data.conversation.push({ role: 'assistant', content: repVocale });
 
  const twiml = new twilio.twiml.VoiceResponse();
 
  const gather = twiml.gather({
    input: 'speech',
    language: 'fr-FR',
    speechTimeout: 'auto',
    action: `/motif-appel?callSid=${callSid}`,
    method: 'POST'
  });
 
  gather.say({ voice: 'Polly.Lea', language: 'fr-FR' }, repVocale);
  twiml.pause({ length: 5 });
  twiml.redirect({ method: 'POST' }, `/attente-decision?callSid=${callSid}`);
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── 3. MOTIF DE L'APPEL ─────────────────────────────────────────────────────
app.post('/motif-appel', async (req, res) => {
  const callSid      = req.query.callSid || req.body.CallSid;
  const speechResult = req.body.SpeechResult || '';
  const data         = appelsEnCours[callSid] || { conversation: [] };
 
  data.conversation.push({ role: 'user', content: speechResult });
 
  // Mise à jour SMS avec le motif
  const smsUpdate = `${data.sms || 'Appelant'} — Motif : ${speechResult}`;
  try {
    await client.messages.create({
      body: `📞 VYLURIS — ${smsUpdate}\n\nRépondez OUI pour transférer, NON pour décliner.`,
      from: TWILIO_PHONE,
      to:   TONY_PHONE
    });
  } catch (err) {
    console.error('Erreur SMS motif:', err.message);
  }
 
  const rep = await giorgiaRepond(data.conversation,
    `L'appelant vient de donner son motif : "${speechResult}". 
    Informe-le naturellement que tu vas vérifier la disponibilité de Monsieur Calderini et qu'il va patienter un instant.`
  );
 
  data.conversation.push({ role: 'assistant', content: rep });
  appelsEnCours[callSid] = data;
 
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Lea', language: 'fr-FR' }, rep);
  twiml.pause({ length: 25 });
  twiml.redirect({ method: 'POST' }, `/verifier-reponse?callSid=${callSid}`);
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── 4. ATTENTE DÉCISION (si Tony n'a pas encore répondu) ────────────────────
app.post('/attente-decision', async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
 
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Lea', language: 'fr-FR' },
    'Je vérifie la disponibilité de Monsieur Calderini. Un instant s\'il vous plaît.');
  twiml.pause({ length: 25 });
  twiml.redirect({ method: 'POST' }, `/verifier-reponse?callSid=${callSid}`);
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── 5. RÉPONSE SMS DE TONY ───────────────────────────────────────────────────
app.post('/sms-reponse', (req, res) => {
  const body = (req.body.Body || '').trim().toUpperCase();
 
  for (const [callSid, data] of Object.entries(appelsEnCours)) {
    if (!data.decision) {
      data.decision = (body === 'OUI' || body === 'O' || body === 'OK') ? 'OUI' : 'NON';
      break;
    }
  }
 
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message((body === 'OUI' || body === 'O' || body === 'OK')
    ? '✅ Transfert en cours...'
    : '❌ Appel décliné.');
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── 6. VÉRIFICATION DÉCISION ────────────────────────────────────────────────
app.post('/verifier-reponse', async (req, res) => {
  const callSid = req.query.callSid || req.body.CallSid;
  const data    = appelsEnCours[callSid] || {};
  const twiml   = new twilio.twiml.VoiceResponse();
 
  if (data.decision === 'OUI') {
    const rep = await giorgiaRepond(data.conversation || [],
      'Annonce à l\'appelant que tu le transfères maintenant vers Monsieur Calderini. Courte phrase chaleureuse.');
    twiml.say({ voice: 'Polly.Lea', language: 'fr-FR' }, rep);
    twiml.dial(TONY_PHONE);
    delete appelsEnCours[callSid];
 
  } else if (data.decision === 'NON') {
    const rep = await giorgiaRepond(data.conversation || [],
      'Annonce à l\'appelant que Monsieur Calderini est indisponible et propose de prendre un message. Naturel et chaleureux.');
    const gather = twiml.gather({
      input: 'speech',
      language: 'fr-FR',
      speechTimeout: 'auto',
      action: `/prendre-message?callSid=${callSid}`,
      method: 'POST'
    });
    gather.say({ voice: 'Polly.Lea', language: 'fr-FR' }, rep);
 
  } else {
    // Pas encore de réponse — on repoll avec musique d'attente
    twiml.pause({ length: 15 });
    twiml.redirect({ method: 'POST' }, `/verifier-reponse?callSid=${callSid}`);
  }
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── 7. PRISE DE MESSAGE ─────────────────────────────────────────────────────
app.post('/prendre-message', async (req, res) => {
  const callSid      = req.query.callSid;
  const speechResult = req.body.SpeechResult || '';
  const data         = appelsEnCours[callSid] || {};
 
  if (speechResult) {
    try {
      await client.messages.create({
        body: `📝 Message de ${data.sms || 'l\'appelant'} :\n"${speechResult}"`,
        from: TWILIO_PHONE,
        to:   TONY_PHONE
      });
    } catch (err) {
      console.error('Erreur SMS message:', err.message);
    }
  }
 
  const conge = await giorgiaRepond(data.conversation || [],
    'Confirme à l\'appelant que son message a bien été transmis et prends congé de façon chaleureuse et professionnelle.');
 
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Lea', language: 'fr-FR' }, conge);
 
  delete appelsEnCours[callSid];
 
  res.type('text/xml');
  res.send(twiml.toString());
});
 
// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Giorgia — Secrétaire VYLURIS démarrée sur le port ${PORT}`);
});
