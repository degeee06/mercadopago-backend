import express from "express";
import cors from "cors";
import mercadopago from "mercadopago";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json()); // Para outros endpoints

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Inicializa Mercado Pago (Produção)
const { MercadoPagoConfig, Payment } = mercadopago;
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN // PROD-xxx
});
const payment = new Payment(mp);

// Armazena status de pagamentos temporariamente
const pagamentos = {};

// Endpoint para criar PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;

  try {
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount),
        description: description || "Pagamento VIP",
        payment_method_id: "pix",
        payer: { email: email }
      }
    });

    pagamentos[result.id] = "pending";

    res.json({
      id: result.id,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para checar status do pagamento (polling frontend)
app.get("/status-pix/:id", (req, res) => {
  const id = req.params.id;
  const status = pagamentos[id] || "pending";
  res.json({ status });
});

// Webhook do Mercado Pago (produção) com HMAC correto
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const topic = req.query.topic; // "payment" ou "merchant_order"
  const id = req.query.id;       // ID do pagamento ou pedido

  const signature = req.headers["x-meli-signature"];
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!signature || !secret) {
    console.log("Webhook inválido! Sem assinatura ou segredo.");
    return res.sendStatus(401);
  }

  // Calcula HMAC-SHA256 do body RAW
  const hmac = crypto.createHmac("sha256", secret);
  const digest = hmac.update(req.body).digest("base64");

  if (signature !== digest) {
    console.log("Webhook inválido! Assinatura não conferiu.");
    return res.sendStatus(401);
  }

  console.log("=== Webhook validado ===");
  console.log("Topic:", topic, "ID:", id);

  try {
    if (topic === "payment") {
      // Consulta detalhes do pagamento usando token de produção
      const paymentDetails = await mp.payment.findById(id);
      console.log("Detalhes do pagamento:", paymentDetails);

      // Atualiza status temporário ou banco
      pagamentos[id] = paymentDetails.status;

      // Aqui você pode liberar VIP ou atualizar seu sistema
      // Exemplo: liberarVIP(paymentDetails.payer.email)
    }
  } catch (err) {
    console.error("Erro ao buscar detalhes do pagamento:", err.message);
  }

  // Retorna 200 para Mercado Pago
  res.sendStatus(200);
});


// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
