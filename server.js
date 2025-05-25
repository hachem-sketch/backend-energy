require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { HfInference } = require('@huggingface/inference'); // Remplacement OpenAI
const Joi = require('joi');

const app = express();
const PORT = process.env.PORT || 5000;

// Vérification des variables d'environnement
const requiredEnvVars = ['MONGO_URI', 'MQTT_BROKER', 'HF_TOKEN'];
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar]) {
    console.error(`❌ Variable manquante: ${envVar}`);
    process.exit(1);
  }
});

// Middleware sécurisé
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*'
}));
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('dev'));

// Limitation de requêtes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Trop de requêtes depuis cette IP'
});
app.use('/api/', limiter);

// Connexion MongoDB optimisée
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('✅ Connecté à MongoDB'))
.catch(err => {
  console.error('❌ Erreur MongoDB:', err.message);
  process.exit(1);
});

// Schéma Mongoose amélioré
const EnergySchema = new mongoose.Schema({
  temperature: { type: Number, min: -50, max: 100 },
  humidity: { type: Number, min: 0, max: 100 },
  voltage: { type: Number, min: 0 },
  current_20A: { type: Number, min: 0 },
  current_30A: { type: Number, min: 0 },
  sct013: { type: Number, min: 0 },
  waterFlow: { type: Number, min: 0 },
  gasDetected: { type: Number, enum: [0, 1] },
  level: { type: Number, min: 0, max: 100 },
  timestamp: { type: Date, default: Date.now, index: true }
});

const EnergyModel = mongoose.model('Energy', EnergySchema);

// Connexion MQTT avec gestion d'erreurs
const mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
  reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
  console.log('🔗 Connecté à MQTT');
  mqttClient.subscribe('maison/energie', { qos: 1 }, err => {
    if (err) console.error('❌ Erreur MQTT:', err);
  });
});

mqttClient.on('message', async (topic, msg) => {
  try {
    const data = JSON.parse(msg.toString());
    await EnergyModel.create(data);
    console.log(`📊 Données sauvegardées: ${data.timestamp}`);
  } catch (err) {
    console.error('⚠️ Erreur traitement MQTT:', err.message);
  }
});

// Initialisation Hugging Face
const hf = new HfInference(process.env.HF_TOKEN);

async function askAI(question) {
  try {
    const response = await hf.textGeneration({
      model: 'microsoft/DialoGPT-medium-arabic',
      inputs: `أنت خبير في الطاقة. ${question}`,
      parameters: {
        max_length: 200,
        temperature: 0.7
      }
    });
    return response.generated_text;
  } catch (err) {
    console.error('❌ Erreur Hugging Face:', err.message);
    throw new Error('Service IA indisponible');
  }
}

// Routes API
app.get('/api/energy', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const data = await EnergyModel.find()
      .sort('-timestamp')
      .limit(limit)
      .lean();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Erreur base de données' });
  }
});

app.post('/api/chatbot', async (req, res) => {
  const schema = Joi.object({
    question: Joi.string().min(3).max(500).required()
  });

  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const answer = await askAI(req.body.question);
    res.json({ answer });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('💥 Erreur:', err.stack);
  res.status(500).json({ error: 'Erreur interne' });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur');
  mongoose.connection.close();
  mqttClient.end();
  process.exit(0);
});
