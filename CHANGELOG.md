# DoseCheck - Changelog

Todas as mudanças importantes do projeto estão documentadas aqui.  
Este projeto segue [Semantic Versioning](https://semver.org/lang/pt_BR/).

---

## [1.5.2] - 17 de janeiro de 2026

### Adicionado
- **Gráfico de evolução de peso no Dashboard**: Novo card com canvas mostrando os últimos 30 ou 90 dias de pesos, com pontos clicáveis para visualizar data/hora e valor.
- **Aba Medidas reestruturada**: 
  - Reordenação dos campos principais: **Pescoço**, **Cintura**, **Quadril** (ordem de entrada intuitiva).
  - Silhueta translúcida ao fundo do formulário como referência visual.
  - Marcadores de orientação ("Pescoço", "Cintura", "Quadril") sobre a silhueta.
  - Ajustes responsivos para mobile/tablet.
- **SVG de silhueta corporal**: Novo arquivo `icons/body-silhouette.svg` com guia visual para posicionamento das medidas.
- **Pré-cache da silhueta no Service Worker**: Garantia de disponibilidade offline.

### Alterado
- **Insights IA**: Automação completa da análise (remoção de botões "Montar resumo" e "Analisar com IA").
- **Dashboard**: Simplificação visual com foco em "Próxima aplicação", "Último peso" e "Evolução de peso".
- **Service Worker (v3)**: Bump de cache para garantir atualizações de assets (`.cache-v3`).

### Corrigido
- Eliminação de erro `501 Unsupported method ('POST')` ao tentar chamar `/api/analyze` (API agora é local-only).
- Inconsistências entre interface e lógica de dados causadas por cache do Service Worker.

### Técnico
- `APP_VERSION` atualizado para `1.5.2`.
- Tag git `v1.5.2` criada e publicada.
- Gráfico de peso utiliza canvas 2D com eixos, ticks e linha conectando pontos.
- Tooltip interativo ao tocar/clicar nos pontos do gráfico.

---

## [1.5.1] - [Data anterior]

### Alterado
- Refinamentos na interface de Insights IA.
- Melhorias no cálculo de deltas de peso (7, 14, 30 dias).

---

## [1.5.0] - [Data anterior]

### Adicionado
- Insights IA com análise automática de dados reais.
- WhatsApp share para resumo de análises.

---

## Guia de Atualização

Para aplicar as mudanças da versão 1.5.2 em seu navegador:

1. **Hard reload** (força limpeza de cache do Service Worker):
   - `Ctrl + Shift + R` no navegador.
   - Ou: DevTools → Application → Service Workers → "Unregister" e recarregue.

2. **Aceite o banner "Atualizar"** se o app exibir (manual update prompt).

3. **Verifique a versão** em Configurações → versão do app (deve exibir `1.5.2`).

---

## Recursos em Desenvolvimento

- [ ] Suporte a múltiplas unidades de medida (cm/in, kg/lb).
- [ ] Exportação de gráfico de peso como imagem (PNG).
- [ ] Integração com calendário do sistema.
- [ ] Temas escuro/claro com persistência.

---

## Suporte

Para relatar problemas ou sugerir melhorias, abra uma issue no [repositório GitHub](https://github.com/Brefire79/PesoMed).
