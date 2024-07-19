const wppconnect = require('@wppconnect-team/wppconnect');
const dotenv = require('dotenv');
const axios = require('axios');
const {
  GoogleGenerativeAI,
} = require('@google/generative-ai');

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

// Inicializa o wppconnect e chama a função iniciar
wppconnect
  .create({
    useChrome: false,
    logQR: true,
    browserArgs: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    disableWelcome: true    
  })
  .then((client) => start(client))
  .catch((error) => console.log(error));

// Função que inicia a conexão com o WhatsApp
async function start(client) {
  client.onMessage(async (message) => {
    if (message.from.includes('@c.us') && message.type === 'chat') {
      try {
        // Extrai o nome do contato
        const contactName = message.sender.pushname || message.sender.verifiedName || message.sender.formattedName || 'Contato';

        // Obtém todas as mensagens da conversa
        const allMessages = await client.getAllMessagesInChat(message.from);
        const uniqueMessages = filterUniqueMessages(allMessages);

        // Prepara o histórico para o Gemini, excluindo a última mensagem
        const history = uniqueMessages.slice(0, -1).map(msg => ({
          role: msg.sender.pushname === contactName ? 'user' : 'model',
          parts: [{ text: msg.body || '' }]
        }));

        // Exibe o histórico no console para verificação
        console.log('Histórico para o Gemini:', JSON.stringify(history, null, 2));

        // Verifica se há mensagens no histórico e pega a última mensagem
        const lastMessage = uniqueMessages.length > 0 ? uniqueMessages[uniqueMessages.length - 1] : null;
        const messageToSend = lastMessage ? lastMessage.body || message.body : message.body;

        // Chama o Gemini para gerar a resposta
        const response = await getGeminiResponse(contactName, messageToSend, history);
        await client.sendText(message.from, response);
        console.log('Resposta do Gemini enviada com sucesso');

        // Verifica se a mensagem é uma solicitação e cria uma tarefa no Trello
        const isRequest = await isRequestMessage(message.body);
        if (isRequest) {
          const taskTitle = `Nova Solicitação de ${contactName}`;
          const taskDescription = `**Mensagem Recebida:**\n${message.body}\n\n**Resposta do Gemini:**\n${response}`;
          await createTrelloTask(taskTitle, taskDescription);
          console.log('Tarefa criada no Trello com sucesso');
        } else {
          console.log('Mensagem não é uma solicitação válida');
        }
      } catch (error) {
        console.error('Erro ao enviar resposta do Gemini ou criar tarefa no Trello: ', error);
      }
    }
  });
}

// Função para filtrar mensagens únicas
function filterUniqueMessages(messages) {
  const seenMessageIds = new Set();
  return messages.filter(msg => {
    if (msg.id && msg.body && !seenMessageIds.has(msg.id) && msg.body.trim() !== '') {
      seenMessageIds.add(msg.id);
      return true;
    }
    return false;
  });
}

// Função que verifica se a mensagem é uma solicitação
async function isRequestMessage(inputText) {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: 'Classifique se a mensagem é uma solicitação ou pedido. responda apenas sim ou não',
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 50,
    responseMimeType: 'text/plain',
  };

  const chatSession = model.startChat({
    generationConfig,
  });

  const result = await chatSession.sendMessage(inputText);
  const response = result.response.text().toLowerCase();

  // Define critérios para considerar a mensagem uma solicitação
  return response.includes('sim') || response.includes('pedido') || response.includes('solicitação');
}

// Função que chama a API do Gemini para gerar a resposta
async function getGeminiResponse(contactName, inputText, history) {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: 'Seu nome é Fábio, vocé é muito inteligente. Você trabalha com marketing digital. Voce trabalha home-office. Voce conversa parecido com o Abraham Lincoln. Voce ja estudou filosofia e teologia.',
  });

  const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 500,
    responseMimeType: 'text/plain',
  };

  const chatSession = model.startChat({
    generationConfig,
    history: [
      ...history,
      {
        role: 'user',
        parts: [{ text: `Mensagem de ${contactName}: ${inputText}` }],
      }
    ]
  });

  const result = await chatSession.sendMessage(inputText);
  return result.response.text();
}

// Função que cria uma tarefa no Trello
async function createTrelloTask(title, description) {
  const trelloKey = process.env.TRELLO_KEY;
  const trelloToken = process.env.TRELLO_TOKEN;
  const listId = process.env.TRELLO_LIST_ID;

  const url = `https://api.trello.com/1/cards?key=${trelloKey}&token=${trelloToken}&idList=${listId}&name=${encodeURIComponent(title)}&desc=${encodeURIComponent(description)}`;

  await axios.post(url);
}
