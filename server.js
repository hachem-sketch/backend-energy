require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const mqtt = require("mqtt");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const swaggerJsDoc = require("swagger-jsdoc");
const Joi = require("joi");
const axios = require("axios");
const { OpenAIApi, Configuration } = require("openai");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("combined"));

// Limiteur de requêtes
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limite à 1000 requêtes par fenêtre
    message: "🚫 Vous avez atteint la limite de requêtes. Essayez plus tard."
});
app.use(limiter);

// Connexion MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("💾 Connecté à MongoDB"))
    .catch(err => console.error("❌ Erreur de connexion à MongoDB:", err));

// Schéma des données
const EnergySchema = new mongoose.Schema({
    temperature: Number,
    humidity: Number,
    voltage: Number,
    current_20A: Number,
    current_30A: Number,
    sct013: Number,
    waterFlow: Number,
    gasDetected: Number,
    level: Number,
    timestamp: { type: Date, default: Date.now }
});
const EnergyModel = mongoose.model("Energy", EnergySchema);

// Connexion MQTT
const client = mqtt.connect(process.env.MQTT_BROKER);
client.on("connect", () => {
    console.log("🔗 Connecté au serveur MQTT");
    client.subscribe("maison/energie");
});
client.on("message", (topic, message) => {
    try {
        const data = JSON.parse(message.toString());
        const newEntry = new EnergyModel({
            temperature: data.temperature ?? null,
            humidity: data.humidity ?? null,
            voltage: data.voltage ?? null,
            current_20A: data.current_20A ?? null,
            current_30A: data.current_30A ?? null,
            sct013: data.sct013 ?? null,
            waterFlow: data.waterFlow ?? null,
            gasDetected: data.gasDetected ?? null,
            level: data.level ?? null
        });
        newEntry.save()
            .then(() => console.log("✅ Données MQTT sauvegardées avec succès:", newEntry))
            .catch(err => console.error("❌ Erreur de sauvegarde des données:", err));
    } catch (error) {
        console.error("⚠️ Erreur lors de la conversion du message MQTT en JSON:", error);
    }
});

// Routes API classiques
app.get("/", (req, res) => {
    res.send("🚀 Le serveur fonctionne avec succès!");
});

app.get("/energy", async (req, res) => {
    try {
        const data = await EnergyModel.find().sort({ timestamp: -1 }).limit(250);
        res.json(data);
    } catch (error) {
        res.status(500).send("Erreur lors de la récupération des données.");
    }
});

app.post("/energy", async (req, res) => {
    const schema = Joi.object({
        temperature: Joi.number(),
        humidity: Joi.number(),
        voltage: Joi.number(),
        current_20A: Joi.number(),
        current_30A: Joi.number(),
        sct013: Joi.number(),
        waterFlow: Joi.number(),
        gasDetected: Joi.number(),
        level: Joi.number()
    });

    const { error } = schema.validate(req.body);
    if (error) return res.status(400).send(error.details[0].message);

    try {
        const newData = new EnergyModel(req.body);
        await newData.save();
        res.status(201).json({ message: "📊 Données sauvegardées avec succès!" });
    } catch (error) {
        res.status(500).send("Erreur lors de la sauvegarde des données.");
    }
});

// Configuration OpenAI
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

// Fonction chatbot
async function askOpenAI(question) {
    try {
        const response = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "Vous êtes un assistant intelligent spécialisé dans la gestion de l'énergie." },
                { role: "user", content: question }
            ]
        });
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error("❌ Erreur lors de la communication avec OpenAI:", error.response?.data || error.message);
        throw new Error("Erreur lors de la communication avec OpenAI.");
    }
}

// Endpoint chatbot
app.post("/chatbot", async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).send("Veuillez poser une question.");

    try {
        const answer = await askOpenAI(question);
        res.json({ answer });
    } catch (error) {
        res.status(500).send("❌ Erreur lors de l'obtention de la réponse d'OpenAI.");
    }
});

// Swagger
const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "API de gestion de l'énergie et détection de gaz",
            version: "1.0.0",
            description: "API pour collecter des données sur la consommation d'énergie, d'eau et de gaz"
        },
        servers: [{ url: `http://localhost:${PORT}` }]
    },
    apis: ["server.js"]
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Démarrage
app.listen(PORT, () => {
    console.log(`🚀 Le serveur fonctionne sur http://localhost:${PORT}`);
});
