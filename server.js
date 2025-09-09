import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { MercadoPagoConfig, Payment } from "mercadopago";

const app = express();
app.use(cors());
app.use(express.json()); // Para endpoints normais

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Inicializa Mercado Pago (Produção) com SDK 2.x
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN, // PROD-xxx
});

const payment = new Payment(mpClient);

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
        payer: { email },
      },
    });

    pagamentos[result.id] = "pending";

    res.json({
      id: result.id,
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64:
        result.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para checar status do pagamento (frontend faz polling)
app.get("/status-pix/:id", (req, res) => {
  const id = req.params.id;
  const status = pagamentos[id] || "pending";
  res.json({ status });
});

// Webhook Mercado Pago (produção) com HMAC
app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const signatureHeader = req.headers["x-signature"];
  const secret = process.env.MP_WEBHOOK_SECRET;

  if (!signatureHeader || !secret) {
    console.log("Webhook inválido! Sem assinatura ou segredo.");
    return res.sendStatus(401);
  }

  // Parse do x-signature
  const parts = signatureHeader.split(",");
  let ts = "",
    v1 = "";
  for (const p of parts) {
    const [key, value] = p.split("=");
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }

  // Extrai data.id do query param
  const dataId = (req.query["data.id"] || "").toLowerCase();
  const xRequestId = req.headers["x-request-id"] || "";

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const computedHash = crypto
    .createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  if (computedHash !== v1) {
    console.log("Webhook inválido! Assinatura não conferiu.");
    return res.sendStatus(401);
  }

  console.log("=== Webhook validado ✅ ===");

  try {
    const paymentId = req.query.id;
    if (paymentId) {
      const paymentDetails = await payment.get(paymentId);
      console.log("Detalhes do pagamento:", paymentDetails.body);

      pagamentos[paymentId] = paymentDetails.body.status;

      // Aqui você pode liberar VIP ou atualizar banco
      // Ex: liberarVIP(paymentDetails.body.payer.email)
    }
  } catch (err) {
    console.error("Erro ao buscar detalhes do pagamento:", err.message);
  }

  res.sendStatus(200);
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
