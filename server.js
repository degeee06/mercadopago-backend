import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import mercadopago from "mercadopago";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---------------- Supabase ----------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------- Mercado Pago ----------------
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// ---------------- App ----------------
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------- Criar pagamento PIX ----------------
app.post("/create-pix", async (req, res) => {
  try {
    const { email, amount, validUntil } = req.body;
    const payment_data = {
      transaction_amount: parseFloat(amount),
      description: "Plano VIP",
      payment_method_id: "pix",
      payer: { email },
    };
    const payment = await mercadopago.payment.create(payment_data);
    // Salvar no Supabase
    await supabase.from("pagamentos").insert([
      {
        id: payment.body.id.toString(),
        email,
        amount,
        status: payment.body.status,
        valid_until: validUntil,
      },
    ]);
    res.json({
      qr_code_base64: payment.body.point_of_interaction.transaction_data.qr_code_base64,
      qr_code: payment.body.point_of_interaction.transaction_data.qr_code,
      id: payment.body.id,
    });
  } catch (err) {
    console.error("Erro ao criar PIX:", err);
    res.status(500).json({ msg: "Erro ao criar pagamento" });
  }
});

// ---------------- Webhook Mercado Pago ----------------
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.query.id || req.query["data.id"];
    if (!paymentId) {
      return res.status(400).json({ msg: "Pagamento ID não encontrado" });
    }

    const payment = await mercadopago.payment.findById(paymentId);
    const { id, status, payer } = payment.body;

    // Atualiza tabela de pagamentos
    await supabase
      .from("pagamentos")
      .update({ status })
      .eq("id", id.toString());

    // Se aprovado → atualiza também a tabela de usuários
    if (status === "approved") {
      const { data: pg, error } = await supabase
        .from("pagamentos")
        .select("valid_until")
        .eq("id", id.toString())
        .single();

      if (!error && pg) {
        await supabase
          .from("users")
          .update({
            plano: "vip",
            vip_valid_until: pg.valid_until,
          })
          .eq("email", payer.email);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro webhook:", err);
    res.status(500).json({ msg: "Erro no webhook" });
  }
});

// ---------------- Verificação VIP ----------------
app.get("/check-vip/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("plano, vip_valid_until")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.json({ plano: "free" });
    }

    // Checa expiração
    let plano = user.plano;
    if (
      plano === "vip" &&
      user.vip_valid_until &&
      new Date(user.vip_valid_until) < new Date()
    ) {
      await supabase
        .from("users")
        .update({ plano: "free", vip_valid_until: null })
        .eq("email", email);
      plano = "free";
    }

    res.json({ plano, valid_until: user.vip_valid_until });
  } catch (err) {
    console.error("Erro check-vip:", err);
    res.status(500).json({ msg: "Erro ao verificar VIP" });
  }
});

// ---------------- Rotas básicas ----------------
app.get("/", (req, res) => res.send("Servidor rodando"));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
