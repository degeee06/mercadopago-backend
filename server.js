import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---------------- Supabase ----------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ---------------- Clientes e planilhas ----------------
const planilhasClientes = {
  cliente1: process.env.ID_PLANILHA_CLIENTE1,
  cliente2: process.env.ID_PLANILHA_CLIENTE2
};
const clientesValidos = Object.keys(planilhasClientes);

// ---------------- Google Service Account ----------------
let creds;
try {
  creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
} catch (e) {
  console.error("Erro ao parsear GOOGLE_SERVICE_ACCOUNT:", e);
  process.exit(1);
}

// ---------------- App ----------------
const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------- Middleware Auth ----------------
async function authMiddleware(req, res, next) {
  const token = req.headers["authorization"]?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ msg: "Token não enviado" });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ msg: "Token inválido" });

  req.user = data.user;
  req.clienteId = data.user.user_metadata.cliente_id;
  if (!req.clienteId) return res.status(403).json({ msg: "Usuário sem cliente_id" });
  next();
}

// ---------------- Google Sheets ----------------
async function accessSpreadsheet(cliente) {
  const SPREADSHEET_ID = planilhasClientes[cliente];
  const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc;
}

async function ensureDynamicHeaders(sheet, newKeys) {
  await sheet.loadHeaderRow().catch(async () => await sheet.setHeaderRow(newKeys));
  const currentHeaders = sheet.headerValues || [];
  const headersToAdd = newKeys.filter((k) => !currentHeaders.includes(k));
  if (headersToAdd.length > 0) {
    await sheet.setHeaderRow([...currentHeaders, ...headersToAdd]);
  }
}


// ---------------- Disponibilidade ----------------
async function horarioDisponivel(cliente, data, horario) {
  const { data: agendamentos, error } = await supabase
    .from("agendamentos")
    .select("*")
    .eq("cliente", cliente)
    .eq("data", data)
    .eq("horario", horario)
    .neq("status", "cancelado"); // só bloqueia horários não cancelados

  if (error) throw error;

  return agendamentos.length === 0; // se não houver agendamento ativo, horário livre
}



// ---------------- Rotas ----------------
app.get("/", (req, res) => res.send("Servidor rodando"));

app.get("/:cliente", (req, res) => {
  const cliente = req.params.cliente;
  if (!clientesValidos.includes(cliente)) return res.status(404).send("Cliente não encontrado");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


// ---------------- Webhook MercadoPago ----------------
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const payment = req.body; // recebe o payload do MercadoPago
    const { email, status } = payment;

    // Atualiza ou cria pagamento no Supabase
    await supabase
      .from("pagamentos")
      .upsert([{
        id: payment.id,
        email,
        amount: payment.transaction_amount,
        status,
        valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000) // válido por 1 dia
      }]);

    // ---------------- Verifica limite de agendamentos ----------------
    // Se o status do pagamento for 'approved', libera agendamento ilimitado
    if (status !== "approved") {
      // Conta quantos agendamentos já existem hoje para este email
      const { data: agendamentosHoje } = await supabase
        .from("agendamentos")
        .select("*")
        .eq("email", email)
        .eq("data", new Date().toISOString().split("T")[0]) // hoje
        .neq("status", "cancelado");

      if (agendamentosHoje.length >= 3) {
        console.log(`Limite atingido para ${email}, plano free`);
        // Aqui você pode enviar notificação ou bloquear novos agendamentos
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.status(500).send("Erro interno");
  }
});




// ---------------- Agendar com limite para free ----------------
app.post("/agendar/:cliente", authMiddleware, async (req, res) => {
  try {
    const cliente = req.params.cliente;
    if (req.clienteId !== cliente) return res.status(403).json({ msg: "Acesso negado" });

    const { Nome, Email, Telefone, Data, Horario } = req.body;
    if (!Nome || !Email || !Telefone || !Data || !Horario)
      return res.status(400).json({ msg: "Todos os campos obrigatórios" });

    // 1️⃣ Verifica pagamento ativo
    const { data: pagamento } = await supabase
      .from("pagamentos")
      .select("*")
      .eq("email", Email)
      .eq("status", "approved")
      .gte("valid_until", new Date())
      .single();

    const isPremium = !!pagamento;

    // 2️⃣ Verifica limite para free
    if (!isPremium) {
      const { data: agendamentosHoje } = await supabase
        .from("agendamentos")
        .select("*")
        .eq("email", Email)
        .eq("data", Data)
        .neq("status", "cancelado");

      if (agendamentosHoje.length >= 3) {
        return res.status(400).json({ msg: "Limite de 3 agendamentos por dia para plano free" });
      }
    }

    // 3️⃣ Checa disponibilidade do horário
    const livre = await horarioDisponivel(cliente, Data, Horario);
    if (!livre) return res.status(400).json({ msg: "Horário indisponível" });

    // 4️⃣ Remove agendamento cancelado no mesmo horário
    await supabase
      .from("agendamentos")
      .delete()
      .eq("cliente", cliente)
      .eq("data", Data)
      .eq("horario", Horario)
      .eq("status", "cancelado");

    // 5️⃣ Insere novo agendamento
    const { data, error } = await supabase
      .from("agendamentos")
      .insert([{
        cliente,
        nome: Nome,
        email: Email,
        telefone: Telefone,
        data: Data,
        horario: Horario,
        status: isPremium ? "confirmado" : "pendente",
        confirmado: isPremium // confirma automaticamente se pago
      }])
      .select()
      .single();

    if (error) return res.status(500).json({ msg: "Erro ao salvar no Supabase" });

    // 6️⃣ Salva no Google Sheets
    const doc = await accessSpreadsheet(cliente);
    const sheet = doc.sheetsByIndex[0];
    await ensureDynamicHeaders(sheet, Object.keys(data));
    await sheet.addRow(data);

    res.json({ msg: "Agendamento realizado com sucesso!", agendamento: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Erro interno" });
  }
});

// ---------------- Webhook MercadoPago ----------------
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const payment = req.body;
    const { email, status } = payment;

    await supabase
      .from("pagamentos")
      .upsert([{
        id: payment.id,
        email,
        amount: payment.transaction_amount,
        status,
        valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000) // válido por 1 dia
      }]);

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro webhook MP:", err);
    res.status(500).send("Erro interno");
  }
});


// ---------------- Confirmar ----------------
app.post("/confirmar/:cliente/:id", authMiddleware, async (req, res) => {
  try {
    const cliente = req.params.cliente;
    if (req.clienteId !== cliente) return res.status(403).json({ msg: "Acesso negado" });

    const { id } = req.params;
    const { data, error } = await supabase
      .from("agendamentos")
      .update({ status: "confirmado", confirmado: true })
      .eq("id", id)
      .eq("cliente", cliente)
      .select()
      .single();
    if (error) return res.status(500).json({ msg: "Erro ao confirmar agendamento" });
    if (!data) return res.status(404).json({ msg: "Agendamento não encontrado" });

    const doc = await accessSpreadsheet(cliente);
    const sheet = doc.sheetsByIndex[0];
    await ensureDynamicHeaders(sheet, Object.keys(data));
    const rows = await sheet.getRows();
    const row = rows.find(r => r.id === data.id);
    if (row) {
      row.status = "confirmado";
      row.confirmado = true;
      await row.save();
    } else {
      await sheet.addRow(data);
    }

    res.json({ msg: "Agendamento confirmado!", agendamento: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Erro interno" });
  }
});

// ---------------- Cancelar ----------------
app.post("/cancelar/:cliente/:id", authMiddleware, async (req, res) => {
  try {
    const { cliente, id } = req.params;
    if (req.clienteId !== cliente) return res.status(403).json({ msg: "Acesso negado" });

    const { data, error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado", confirmado: false })
      .eq("id", id)
      .eq("cliente", cliente)
      .select()
      .single();

    if (error) return res.status(500).json({ msg: "Erro ao cancelar agendamento" });
    if (!data) return res.status(404).json({ msg: "Agendamento não encontrado" });

    const doc = await accessSpreadsheet(cliente);
    const sheet = doc.sheetsByIndex[0];
    await ensureDynamicHeaders(sheet, Object.keys(data));
    const rows = await sheet.getRows();
    const row = rows.find(r => r.id == data.id);
    if (row) {
      row.status = "cancelado";
      row.confirmado = false;
      await row.save();
    } else {
      await sheet.addRow(data);
    }

    res.json({ msg: "Agendamento cancelado!", agendamento: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Erro interno ao cancelar" });
  }
});

// ---------------- Reagendar ----------------
app.post("/reagendar/:cliente/:id", authMiddleware, async (req, res) => {
  try {
    const cliente = req.params.cliente;
    if (req.clienteId !== cliente) return res.status(403).json({ msg: "Acesso negado" });

    const { id } = req.params;
    const { novaData, novoHorario } = req.body;
    if (!novaData || !novoHorario) return res.status(400).json({ msg: "Nova data e horário obrigatórios" });

    const { data: agendamento, error: errorGet } = await supabase
      .from("agendamentos")
      .select("*")
      .eq("id", id)
      .eq("cliente", cliente)
      .single();

    if (errorGet || !agendamento) return res.status(404).json({ msg: "Agendamento não encontrado" });

    // Checa se novo horário está livre, ignorando o próprio ID
   const livre = await horarioDisponivel(cliente, novaData, novoHorario, id);
   if (!livre) return res.status(400).json({ msg: "Horário indisponível" });


    // Atualiza o agendamento existente
    const { data: novo, error: errorUpdate } = await supabase
      .from("agendamentos")
      .update({
        data: novaData,
        horario: novoHorario,
        status: "pendente",
        confirmado: false
      })
      .eq("id", id)
      .select()
      .single();
    if (errorUpdate) return res.status(500).json({ msg: "Erro ao reagendar" });

    const doc = await accessSpreadsheet(cliente);
    const sheet = doc.sheetsByIndex[0];
    await ensureDynamicHeaders(sheet, Object.keys(novo));
    const rows = await sheet.getRows();
    const row = rows.find(r => r.id === novo.id);
    if (row) {
      row.data = novo.data;
      row.horario = novo.horario;
      row.status = novo.status;
      row.confirmado = novo.confirmado;
      await row.save();
    } else {
      await sheet.addRow(novo);
    }

    res.json({ msg: "Reagendamento realizado com sucesso!", agendamento: novo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Erro interno" });
  }
});

// ---------------- Listar ----------------
app.get("/meus-agendamentos/:cliente", authMiddleware, async (req, res) => {
  try {
    const cliente = req.params.cliente;
    if (req.clienteId !== cliente) return res.status(403).json({ msg: "Acesso negado" });

    const { data, error } = await supabase
      .from("agendamentos")
      .select("*")
      .eq("cliente", cliente);
    if (error) return res.status(500).json({ msg: "Erro Supabase" });

    res.json({ agendamentos: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Erro interno" });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));


