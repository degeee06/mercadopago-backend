import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import mercadopago from "mercadopago";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Configuração Mercado Pago 2.8.0
mercadopago.configurations = {
  access_token: process.env.MP_ACCESS_TOKEN, // seu env
};

// Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // seu env

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Variáveis de ambiente Supabase não configuradas corretamente!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Rota teste
app.get("/", (req, res) => res.send("Servidor MercadoPago + Supabase rodando 🚀"));

// Criar pagamento VIP
app.post("/create_preference", async (req, res) => {
  try {
    const { title, price, quantity, email } = req.body;

    const preference = {
      items: [
        {
          title,
          unit_price: Number(price),
          quantity: Number(quantity),
        },
      ],
      payer: { email },
      back_urls: {
        success: "https://seu-app.com/success",
        failure: "https://seu-app.com/failure",
        pending: "https://seu-app.com/pending",
      },
      auto_return: "approved",
    };

    const result = await mercadopago.preferences.create(preference);

    // Insere no Supabase respeitando sua tabela pagamentos
    await supabase.from("pagamentos").insert([
      {
        id: result.body.id,
        email,
        amount: price * quantity,
        status: "pending",
        valid_until: null,
      },
    ]);

    res.json({ id: result.body.id, init_point: result.body.init_point });
  } catch (error) {
    console.error("Erro ao criar preferência:", error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const data = req.body;

    if (data.type === "payment") {
      const paymentId = data.data.id;
      const payment = await mercadopago.payment.findById(paymentId);

      const status = payment.body.status;
      const id = payment.body.order.id;

      let updates = { status };

      // Se aprovado, define validade VIP (+30 dias)
      if (status === "approved") {
        const now = new Date();
        const validUntil = new Date(now.setDate(now.getDate() + 30));
        updates.valid_until = validUntil.toISOString();
      }

      await supabase
        .from("pagamentos")
        .update(updates)
        .eq("id", id);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro webhook:", error);
    res.sendStatus(500);
  }
});

// Porta
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
