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

const app = express();
const PORT = process.env.PORT || 5000;

// التحقق من وجود متغيرات البيئة الضرورية
if (!process.env.MONGO_URI) {
  console.error("❌ يرجى تعيين متغير البيئة MONGO_URI في ملف .env");
  process.exit(1);
}
if (!process.env.MQTT_BROKER) {
  console.error("❌ يرجى تعيين متغير البيئة MQTT_BROKER في ملف .env");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ يرجى تعيين متغير البيئة OPENAI_API_KEY في ملف .env");
  process.exit(1);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("combined"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: "🚫 تم تجاوز الحد الأقصى للطلبات. يرجى المحاولة لاحقًا."
});
app.use(limiter);

// اتصال MongoDB
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("💾 تم الاتصال بقاعدة بيانات MongoDB"))
  .catch(err => {
    console.error("❌ خطأ في الاتصال بقاعدة البيانات:", err);
    process.exit(1);
  });

// نموذج البيانات
const EnergySchema = new mongoose.Schema({
  temperature: { type: Number, default: null },
  humidity: { type: Number, default: null },
  voltage: { type: Number, default: null },
  current_20A: { type: Number, default: null },
  current_30A: { type: Number, default: null },
  sct013: { type: Number, default: null },
  waterFlow: { type: Number, default: null },
  gasDetected: { type: Number, default: null },
  level: { type: Number, default: null },
  timestamp: { type: Date, default: Date.now }
});
const EnergyModel = mongoose.model("Energy", EnergySchema);

// اتصال MQTT
const client = mqtt.connect(process.env.MQTT_BROKER);

client.on("connect", () => {
  console.log("🔗 تم الاتصال بخادم MQTT");
  client.subscribe("maison/energie", err => {
    if (err) console.error("❌ خطأ في الاشتراك بموضوع MQTT:", err);
  });
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
      .then(() => console.log("✅ تم حفظ بيانات MQTT بنجاح:", newEntry))
      .catch(err => console.error("❌ خطأ أثناء الحفظ:", err));
  } catch (error) {
    console.error("⚠️ خطأ في تحويل بيانات MQTT:", error);
  }
});

// دالة استدعاء OpenAI مع التعامل مع الأخطاء
async function askOpenAI(question) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "أنت مساعد ذكي مختص في ترشيد استهلاك الطاقة." },
          { role: "user", content: question }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error("❌ خطأ أثناء الاتصال بـ OpenAI:", error.response?.data || error.message);
    if (error.response && error.response.data && error.response.data.error) {
      const errData = error.response.data.error;
      if (errData.code === "insufficient_quota") {
        throw new Error("تم تجاوز الحصة الحالية في OpenAI. يرجى تجديد الاشتراك أو شحن الرصيد.");
      }
      throw new Error(errData.message || "خطأ في خدمة OpenAI.");
    }
    throw new Error("خطأ غير معروف أثناء الاتصال بـ OpenAI.");
  }
}

// المسارات API

app.get("/", (req, res) => {
  res.send("🚀 الخادم يعمل!");
});

app.get("/energy", async (req, res) => {
  try {
    const data = await EnergyModel.find().sort({ timestamp: -1 }).limit(2000);
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).send("❌ خطأ في جلب البيانات.");
  }
});

app.post("/energy", async (req, res) => {
  const schema = Joi.object({
    temperature: Joi.number().optional(),
    humidity: Joi.number().optional(),
    voltage: Joi.number().optional(),
    current_20A: Joi.number().optional(),
    current_30A: Joi.number().optional(),
    sct013: Joi.number().optional(),
    waterFlow: Joi.number().optional(),
    gasDetected: Joi.number().optional(),
    level: Joi.number().optional()
  });

  const { error } = schema.validate(req.body);
  if (error) return res.status(400).send(error.details[0].message);

  try {
    const newData = new EnergyModel(req.body);
    await newData.save();
    res.status(201).json({ message: "📊 تم حفظ البيانات بنجاح!" });
  } catch (error) {
    console.error(error);
    res.status(500).send("❌ خطأ أثناء الحفظ.");
  }
});

app.post("/chatbot", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).send("يرجى إدخال سؤال.");

  try {
    const answer = await askOpenAI(question);
    res.json({ answer });
  } catch (error) {
    if (error.message.includes("تم تجاوز الحصة")) {
      return res.status(429).json({ error: error.message });
    }
    res.status(500).send("❌ خطأ أثناء الحصول على إجابة من OpenAI.");
  }
});

// مسار اختبار OpenAI
app.get("/test-openai", async (req, res) => {
  try {
    const answer = await askOpenAI("مرحبا");
    res.send(answer);
  } catch (error) {
    res.status(500).send("فشل في الاتصال بـ OpenAI");
  }
});

// توثيق Swagger
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "API إدارة الطاقة وكشف الغاز",
      version: "1.0.0",
      description: "API لجمع بيانات استهلاك الطاقة والمياه وكشف الغاز"
    },
    servers: [{ url: `http://localhost:${PORT}` }]
  },
  apis: ["server.js"]
};
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// بدء الخادم
app.listen(PORT, () => {
  console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
});
