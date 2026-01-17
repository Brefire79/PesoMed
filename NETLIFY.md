# 🚀 Deploy no Netlify

## Pré-requisitos
- Conta no [Netlify](https://app.netlify.com)
- Repositório GitHub configurado (já enviado em https://github.com/Brefire79/PesoMed)

## Opção 1: Via Interface Netlify (Recomendado)

1. Acesse https://app.netlify.com
2. Clique em **"New site from Git"**
3. Selecione **GitHub** como provedor
4. Autorize o Netlify a acessar seus repositórios
5. Selecione o repositório **Brefire79/PesoMed**
6. Configure as opções de build:
   - **Build command**: (deixe em branco, não há build necessário)
   - **Publish directory**: `.` (diretório raiz)
   - **Base directory**: (deixe em branco)
7. Clique em **"Deploy site"**

## Opção 2: Via CLI Netlify

```bash
# Instale o CLI (se ainda não tiver)
npm install -g netlify-cli

# Faça login
netlify login

# Deploy da aplicação
netlify deploy --prod --dir .
```

## Opção 3: Deploy Automático (Recomendado)

Após conectar o GitHub no Netlify:
- Todos os pushes para `main` disparam deployment automático
- Histórico de deploys é rastreado automaticamente
- Rollback é possível via dashboard

## Verificação Pós-Deploy

1. Acesse a URL fornecida pelo Netlify (ex: `https://your-site.netlify.app`)
2. Teste as principais funcionalidades:
   - ✅ Dashboard carrega
   - ✅ Registrar aplicação
   - ✅ Gráfico de peso
   - ✅ Compartilhar resumo (Insights)
   - ✅ Offline funciona (abra DevTools → Application → Service Workers → Offline)

## Variáveis de Ambiente

Se necessário adicionar variáveis:
1. Vá para **Site settings** → **Build & deploy** → **Environment**
2. Clique **Edit variables**
3. Adicione conforme necessário

## Troubleshooting

- **Erro 404**: Verifique se a raiz é `.` e o publish directory está correto
- **Service Worker não atualiza**: Limpe cache do navegador e force refresh
- **Deploy não inicia**: Verifique status de build em **Deploys** → **Deploy log**

---

**Site está pronto para ir ao ar!** 🎉
