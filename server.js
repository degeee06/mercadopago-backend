import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment } from "mercadopago";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🔑 Configuração Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN, // define no Render
});

// 🔎 Teste
app.get("/", (req, res) => {
  res.json({ message: "Servidor MercadoPago OK 🚀" });
});

// 📌 Criar pagamento PIX
app.post("/create-payment", async (req, res) => {
  try {
    const payment = new Payment(client);

    const body = {
      transaction_amount: Number(req.body.amount),
      description: "VIP Meloplay",
      payment_method_id: "pix",
      payer: {
        email: req.body.email,
      },
    };

    const result = await payment.create({ body });
    res.json(result);
  } catch (error) {
    console.error("Erro criar pagamento:", error);
    res.status(500).json({ error: error.message });
  }
});

// ▶️ Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
