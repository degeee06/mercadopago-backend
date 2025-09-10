import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));

// Inicializa Mercado Pago
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(mpClient);

// Inicializa Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Cria PIX
app.post("/create-pix", async (req, res) => {
  const { amount, description, email } = req.body;
  if (!amount || !email) return res.status(400).json({ error: "Faltando dados" });

  try {
    const result = await payment.create({
      body: {
        transaction_amount: Number(amount),
        description: description || "Pagamento VIP",
        payment_method_id: "pix",
        payer: { email },
      },
    });

    // Salva no Supabase usando paymentId como chave
    await supabase.from("pagamentos").upsert(
      [
        { id: result.id, email, amount: Number(amount), status: "pending" }
      ],
      { onConflict: ["id"] }
    );

    res.json({
      id: result.id,  // <- chave usada no Flutter
      status: result.status,
      qr_code: result.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: result.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Checa status do pagamento (via Supabase)
app.get("/status-pix/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from("pagamentos").select("status").eq("id", id).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: data?.status || "pending" });
});

// Checa status VIP pelo email (novo endpoint)
app.get("/vip-status", async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Faltando email" });

  const { data, error } = await supabase
    .from("vip_users")
    .select("vip_expires_at")
    .eq("email", email)
    .single();

  if (error && error.code !== "PGRST116") { // ignore not found
    return res.status(500).json({ error: error.message });
  }

  const now = new Date();
  let isVip = false;
  if (data && new Date(data.vip_expires_at) > now) {
    isVip = true;
  }

  res.json({ isVip });
});

// Webhook Mercado Pago
app.post("/webhook", express.json(), async (req, res) => {
  const signatureHeader = req.headers["x-signature"];
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!signatureHeader || !secret) return res.sendStatus(401);

  // Validação da assinatura
  const parts = signatureHeader.split(",");
  let ts = "", v1 = "";
  for (const p of parts) {
    const [key, value] = p.split("=");
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }

  const dataId = (req.query["data.id"] || "").toLowerCase();
  const xRequestId = req.headers["x-request-id"] || "";
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const computedHash = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  if (computedHash !== v1) return res.sendStatus(401);

  console.log("Webhook validado ✅");

  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) {
      console.log("Webhook sem paymentId:", req.body);
      return res.sendStatus(400);
    }

    const paymentDetails = await payment.get({ id: paymentId });

    // Atualiza o Supabase usando paymentId como chave
    await supabase.from("pagamentos")
      .update({ status: paymentDetails.status })
      .eq("id", paymentId);

    console.log("Status atualizado:", paymentId, "->", paymentDetails.status);

    // Se pago ou aprovado, ativa VIP por 30 dias
    if (["approved", "paid"].includes(paymentDetails.status.toLowerCase())) {
      const email = paymentDetails.payer.email;
      const vipExpiresAt = new Date();
      vipExpiresAt.setDate(vipExpiresAt.getDate() + 30); // 30 dias de VIP

      await supabase.from("vip_users").upsert(
        [{ email, vip_expires_at: vipExpiresAt.toISOString() }],
        { onConflict: ["email"] }
      );

      console.log(`VIP ativado para ${email} até ${vipExpiresAt}`);
    }

  } catch (err) {
    console.error("Erro ao atualizar pagamento:", err.message);
  }

  res.sendStatus(200);
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
