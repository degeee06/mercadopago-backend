// server.js
import express from "express";
import fetch from "node-fetch";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());
app.use(express.static(".")); // Serve index.html e outros arquivos estáticos

// ======================== CONFIGURAÇÃO ========================

// Token do Mercado Pago
// Sandbox: TEST-xxxx
// Produção: ACESSO_REAL
const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "TEST-6172816457651620-090719-ef2ac7e7628cc5b8a64d2ca1ddf89c61-469548398";

// Token secreto do webhook (variável de ambiente: MP_WEBHOOK_TOKEN)
const WEBHOOK_TOKEN = process.env.MP_WEBHOOK_TOKEN || "meuTokenSuperSecreto123";

// Banco mínimo em memória (para testes)
const usuariosVIP = {};        // userId -> true
const pagamentos = {};         // paymentId -> userId

// ======================== ENDPOINTS ========================

// Criar pagamento Pix
app.post("/criar-pix", async (req, res) => {
  const { userId, valor } = req.body;

  if (!userId || !valor) return res.status(400).json({ error: "userId e valor são obrigatórios" });

  try {
    const payload = {
      transaction_amount: Number(valor),
      payment_method_id: "pix",
      description: "VIP App Sandbox",
      payer: { email: `${userId}@sandbox.com` }, // Sandbox email
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

    // Salvar paymentId -> userId
    pagamentos[data.id] = userId;

    res.json({
      paymentId: data.id,
      pix_code: data.point_of_interaction.transaction_data.qr_code, // Pix de cópia e cola
      init_point: data.point_of_interaction.transaction_data.qr_code_base64, // Opcional: QR code base64
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Webhook seguro
app.post("/mp-webhook", (req, res) => {
  const token = req.query.token;
  if (token !== WEBHOOK_TOKEN) return res.sendStatus(403);

  const { data, type } = req.body;

  if (type === "payment") {
    const paymentId = data.id;
    const userId = pagamentos[paymentId];
    if (userId) {
      usuariosVIP[userId] = true;
      console.log(`Usuário ${userId} liberado como VIP`);
    }
  }

  res.sendStatus(200);
});

// Verificar VIP
app.get("/vip/:userId", (req, res) => {
  const { userId } = req.params;
  res.json({ vip: !!usuariosVIP[userId] });
});

// ======================== RODAR SERVIDOR ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
