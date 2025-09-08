// server.js
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// Token Sandbox do Mercado Pago (pegar em https://www.mercadopago.com.br/developers/panel)
const ACCESS_TOKEN = "TEST-6172816457651620-090719-ef2ac7e7628cc5b8a64d2ca1ddf89c61-469548398";

// Banco mínimo em memória para testes
const usuariosVIP = {};

// Criar pagamento Pix
app.post("/criar-pix", async (req, res) => {
  const { userId, valor } = req.body;

  try {
    const payload = {
      transaction_amount: valor,
      payment_method_id: "pix",
      description: "VIP App Sandbox",
      payer: { email: `${userId}@sandbox.com` },
    };

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    res.json({
      id: data.id,
      pix_code: data.point_of_interaction.transaction_data.qr_code, // Pix de cópia e cola
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook do Mercado Pago
app.post("/webhook", (req, res) => {
  const { data, type } = req.body;

  if (type === "payment") {
    // Mapear paymentId para userId (teste simples)
    const userId = "user123"; // substitua conforme controle real
    usuariosVIP[userId] = true;
    console.log(`Usuário ${userId} liberado como VIP`);
  }

  res.sendStatus(200);
});

// Verificar VIP
app.get("/vip/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({ vip: !!usuariosVIP[userId] });
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Backend rodando no Render")
);
