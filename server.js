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
        payer: { email }
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

// Endpoint para checar status do pagamento (frontend faz polling)
app.get("/status-pix/:id", (req, res) => {
  const id = req.params.id;
  const status = pagamentos[id] || "pending";
  res.json({ status });
});

// Webhook de produção com validação HMAC SHA256
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const xSignature = req.headers["x-signature"];
  const xRequestId = req.headers["x-request-id"];
  const queryParams = req.query;
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!xSignature || !xRequestId || !secret) {
    console.log("Webhook inválido! Sem assinatura ou segredo.");
    return res.sendStatus(401);
  }

  // Extrai ts e v1
  const parts = xSignature.split(",");
  let ts = "", v1 = "";
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }

  // data.id vem da query param, precisa ser minúsculo
  const dataId = (queryParams["data.id"] || "").toLowerCase();

  // Monta manifest
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Calcula HMAC SHA256 hexadecimal
  const hmac = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  if (hmac !== v1) {
    console.log("Webhook inválido! Assinatura não conferiu.");
    return res.sendStatus(401);
  }

  console.log("=== Webhook validado ✅ ===");
  console.log("Topic:", queryParams.topic || "payment", "ID:", dataId);

  try {
    // Busca detalhes do pagamento para atualizar status
    const paymentDetails = await mp.payment.findById(dataId);
    pagamentos[dataId] = paymentDetails.status;

    console.log("Status atualizado:", paymentDetails.status);
    // Aqui você pode liberar VIP ou atualizar banco
    // Ex: liberarVIP(paymentDetails.payer.email)
  } catch (err) {
    console.error("Erro ao buscar detalhes do pagamento:", err.message);
  }

  res.sendStatus(200); // retorna 200 para o Mercado Pago
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
