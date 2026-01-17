# 💊 DoseCheck

**PWA offline-first para monitorar aplicações, peso e medidas corporais.**

Registro simples, intuitivo e seguro de medicamentos (injeções), pesos diários e medidas. Funciona completamente offline com dados armazenados localmente no seu dispositivo.

---

## 🎯 Recursos Principais

### 📊 Dashboard
- **Próxima aplicação**: Previsão baseada no último registro ou lembrete configurado.
- **Último peso**: Valor mais recente com data e condição (jejum/não-jejum).
- **Evolução de peso**: Gráfico interativo dos últimos 30 ou 90 dias.
- **Deltas de peso**: Variação em 7, 14 e 30 dias.

### 💉 Aplicações (Injeções)
- Registro de data, hora, medicamento, dose e local de aplicação.
- Rodízio automático de sugestões de local.
- Edição e exclusão de registros.
- Histórico consolidado.

### ⚖️ Peso & Medidas
- Pesagens com informação de jejum.
- **Medidas corporais**: Pescoço, Cintura, Quadril com guia visual (silhueta).
- Histórico com deltas (diferenças em relação ao registro anterior).

### 🧠 Insights IA
- Análise automática de 30 dias de dados reais.
- Resumo em texto (medicamento, aplicações, pesos, medidas).
- Envio direto para WhatsApp.

### ⚙️ Configurações
- Lembretes personalizados (dia da semana, hora).
- Agenda fixa de pesagens e aplicações.
- Dados do paciente (nome, data de nascimento).
- Backup/Restore manual em JSON.
- Backup automático com histórico.

---

## 🚀 Como Usar

### Na Web
1. Acesse [DoseCheck no navegador](https://brefire79.github.io/PesoMed/) (ou hospede localmente).
2. Aceite instalar como PWA (aparecerá um prompt "Instalar app").
3. Use com ou sem internet — os dados ficam no seu dispositivo.

### Localmente (Desenvolvimento)
```bash
# Clone o repositório
git clone https://github.com/Brefire79/PesoMed.git
cd PesoMed

# Inicie um servidor web (escolha uma opção)
# Opção 1: Python
python -m http.server 8000

# Opção 2: Node.js
npx http-server . -p 8000

# Opção 3: Live Server (VS Code)
# Clique em "Go Live" na barra inferior
```

Então abra `http://localhost:8000` no navegador.

---

## 📱 Navegação

| Aba | Descrição |
|-----|-----------|
| **Dashboard** | Visão geral: próxima aplicação, peso, gráfico e alertas. |
| **Aplicações** | Registro, edição e histórico de injeções. |
| **Peso & Medidas** | Pesagens, medidas corporais e histórico. |
| **Insights IA** | Análise automática dos últimos 30 dias + compartilhamento. |
| **Relatório** | Geração de relatório clínico (PDF ou visualização). |
| **Configurações** | Personalizações, lembretes, dados do paciente e backup. |

---

## 🔒 Privacidade & Segurança

- ✅ **Dados locais**: Tudo é armazenado no IndexedDB do navegador, no seu dispositivo.
- ✅ **Sem servidor**: Nenhum dado é enviado para servidores (exceto ao compartilhar por WhatsApp).
- ✅ **Funciona offline**: PWA totalmente funcional sem internet.
- ✅ **Backup próprio**: Você controla exportação/importação de dados.

---

## 💾 Backup & Restauração

### Exportar Dados
1. Vá para **Configurações** → **Backup & Restauração**.
2. Clique em **"Baixar backup"**.
3. Arquivo JSON será salvo no seu dispositivo.

### Restaurar Dados
1. Vá para **Configurações** → **Backup & Restauração**.
2. Selecione o arquivo JSON exportado anteriormente.
3. Os dados serão restaurados (não apaga os atuais, apenas sincroniza).

---

## 📊 Gráfico de Peso

- **Período**: Alterne entre 30d e 90d.
- **Interatividade**: Toque/clique em um ponto para ver data, hora e peso exato.
- **Eixos**: Mostra faixa mínima/máxima com escala ajustada.
- **Responsivo**: Funciona em mobile, tablet e desktop.

---

## 📝 Guia Rápido de Atalhos

| Ação | Local | Descrição |
|------|-------|-----------|
| **+ Aplicação** | Dashboard / Aplicações | Registra nova injeção. |
| **+ Peso** | Dashboard / Peso & Medidas | Registra nova pesagem. |
| **+ Medidas** | Peso & Medidas | Registra novas medidas (Pescoço, Cintura, Quadril). |
| **Analisar** | Insights IA | Executa análise automática (local). |
| **Enviar para WhatsApp** | Insights IA | Compartilha análise via WhatsApp. |
| **Gerar Relatório** | Relatório | Cria resumo clínico em PDF ou HTML. |

---

## 🛠️ Tecnologia

- **Frontend**: JavaScript puro (sem frameworks).
- **Storage**: IndexedDB (offline-first).
- **PWA**: Service Worker + Web App Manifest.
- **UI**: CSS3 responsivo (mobile-first).
- **Charts**: Canvas 2D (sem bibliotecas externas).

---

## 📦 Versão Atual

**v1.5.2** (17 de janeiro de 2026)

Veja [CHANGELOG.md](CHANGELOG.md) para histórico completo de alterações.

---

## 🤝 Contribuindo

Encontrou um bug ou tem uma sugestão?

1. [Abra uma issue](https://github.com/Brefire79/PesoMed/issues) no GitHub.
2. Descreva o problema ou a ideia.
3. Se possível, inclua prints ou exemplos.

---

## 📄 Licença

Este projeto é de código aberto. Veja o repositório para detalhes.

---

## 📞 Suporte

- **GitHub**: [Brefire79/PesoMed](https://github.com/Brefire79/PesoMed)
- **Issues**: [Reportar problemas](https://github.com/Brefire79/PesoMed/issues)

---

**Desenvolvido com ❤️ para monitoramento simples e seguro de saúde.**
