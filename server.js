require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const mqtt = require('mqtt');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { HfInference } = require('@huggingface/inference');
const Joi = require('joi');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuration de base
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST']
}));
app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(morgan('dev'));

// Limitation des requêtes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: 'Trop de requêtes depuis cette IP'
});
app.use('/api/', limiter);

// Connexion à MongoDB (version moderne)
mongoose.connect(process.env.MONGO_URI)
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

// Configuration MQTT
const mqttClient = mqtt.connect(process.env.MQTT_BROKER, {
  reconnectPeriod: 5000,
  clientId: `nawerli-${Math.random().toString(16).substr(2, 8)}`
});

mqttClient.on('connect', () => {
  console.log('🔗 Connecté à MQTT');
  mqttClient.subscribe('maison/energie', { qos: 1 }, (err) => {
    if (err) console.error('❌ Erreur subscription MQTT:', err);
  });
});

mqttClient.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    await EnergyModel.create(data);
    console.log(`📊 Données MQTT sauvegardées: ${new Date().toISOString()}`);
  } catch (err) {
    console.error('⚠️ Erreur traitement MQTT:', err.message);
  }
});

// Initialisation Hugging Face
const hf = new HfInference(process.env.HF_TOKEN);

async function getAIResponse(question) {
  try {
    const response = await hf.textGeneration({
      model: 'microsoft/DialoGPT-medium-arabic',
      inputs: `أنت خبير في الطاقة. ${question}`,
      parameters: {
        max_length: 200,
        temperature: 0.7,
        do_sample: true
      }
    });
    return response.generated_text;
  } catch (err) {
    console.error('❌ Erreur Hugging Face:', err.message);
    throw new Error('خدمة الذكاء الاصطناعي غير متوفرة حاليا');
  }
}

// Routes API avec préfixe /api
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'active',
    services: {
      mongoDB: mongoose.connection.readyState === 1,
      mqtt: mqttClient.connected
    }
  });
});

app.get('/api/energy', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);
    const data = await EnergyModel.find()
      .sort('-timestamp')
      .limit(limit)
      .lean();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في قاعدة البيانات' });
  }
});

app.post('/api/chatbot', async (req, res) => {
  const schema = Joi.object({
    question: Joi.string().min(3).max(500).required()
  });

  const { error } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  try {
    const answer = await getAIResponse(req.body.question);
    res.json({ answer });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('💥 Erreur:', err.stack);
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});

// Gestion propre de la fermeture
process.on('SIGTERM', () => {
  console.log('🛑 Arrêt du serveur');
  mongoose.connection.close();
  mqttClient.end();
  process.exit(0);
});
