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

// Checa status VIP pelo email (compatível com API antiga do Flutter)
app.get("/check-vip/:email", async (req, res) => {
  const email = req.params.email;
  if (!email) return res.status(400).json({ error: "Faltando email" });

  const { data, error } = await supabase
    .from("vip_users")
    .select("vip_expires_at")
    .eq("email", email)
    .single();

  if (error && error.code !== "PGRST116") {
    return res.status(500).json({ error: error.message });
  }

  const now = new Date();
  let vip = false;
  if (data && new Date(data.vip_expires_at) > now) {
    vip = true;
  }

  res.json({ vip });
});


// Webhook Mercado Pago (com log detalhado)
app.post("/webhook", express.json(), async (req, res) => {
  try {
    console.log("===== WEBHOOK RECEBIDO =====");
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Query:", JSON.stringify(req.query, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));
    console.log("============================");

    const paymentId = req.body?.data?.id || req.query["data.id"];
    if (!paymentId) {
      console.log("❌ Webhook sem paymentId, body:", req.body);
      return res.sendStatus(400);
    }

    console.log("🔎 Buscando detalhes do pagamento:", paymentId);
    const paymentDetails = await payment.get({ id: paymentId });

    console.log("📌 Detalhes do pagamento:", JSON.stringify(paymentDetails, null, 2));

    // Atualiza status no Supabase
    const { error: updateError } = await supabase
      .from("pagamentos")
      .update({ status: paymentDetails.status })
      .eq("id", paymentId);

    if (updateError) {
      console.error("❌ Erro ao atualizar Supabase:", updateError.message);
    } else {
      console.log(`✅ Supabase atualizado: ${paymentId} -> ${paymentDetails.status}`);
    }

    // Se pago/aprovado, ativa VIP
    if (["approved", "paid"].includes(paymentDetails.status.toLowerCase())) {
      const email = paymentDetails.payer.email;
      const vipExpiresAt = new Date();
      vipExpiresAt.setDate(vipExpiresAt.getDate() + 30);

      const { error: vipError } = await supabase.from("vip_users").upsert(
        [{ email, vip_expires_at: vipExpiresAt.toISOString() }],
        { onConflict: ["email"] }
      );

      if (vipError) {
        console.error("❌ Erro ao salvar VIP:", vipError.message);
      } else {
        console.log(`🎉 VIP ativado para ${email} até ${vipExpiresAt}`);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro no webhook:", err.message);
    res.sendStatus(500);
  }
});


// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
