<!-- LEDGR Campaign editable SVG template. Text and shapes are native SVG elements. -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{{W}}" height="{{H}}" viewBox="0 0 {{W}} {{H}}">
<defs>
 <linearGradient id="navy" x2="1" y2="1"><stop stop-color="#0B1730"/><stop offset="1" stop-color="#142B50"/></linearGradient>
 <linearGradient id="gold" x2="1" y2="1"><stop stop-color="#FFD75C"/><stop offset="1" stop-color="#F2B93E"/></linearGradient>
 <linearGradient id="glow" x2="0" y2="1"><stop stop-color="#294975"/><stop offset="1" stop-color="#172B4C"/></linearGradient>
 <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="12" stdDeviation="13" flood-color="#102344" flood-opacity=".14"/></filter>
 <pattern id="grid" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M36 0H0V36" fill="none" stroke="#ffffff" stroke-opacity=".045" stroke-width="1"/></pattern>
</defs>
<rect width="{{W}}" height="{{H}}" fill="#F3F6FA"/>
<!-- Deep navy hero -->
<path d="M0 0H{{W}}V{{HERO}}Q{{W}} {{HERO_END}} {{W_MINUS}} {{HERO_END}}H0Z" fill="url(#navy)"/>
<rect width="{{W}}" height="{{HERO}}" fill="url(#grid)"/>
<circle cx="{{GLOWX}}" cy="{{GLOWY}}" r="{{GLOWR}}" fill="#315587" opacity=".19"/>
<g transform="translate({{PAD}} {{TOP}})">
 <rect width="54" height="54" rx="16" fill="url(#gold)"/>
 <path d="M18 14h7v25h17v7H18z" fill="#102344"/>
 <text x="70" y="35" font-family="Inter,Arial,sans-serif" font-size="35" font-weight="800" letter-spacing="2.1" fill="#fff">LEDGR</text>
 <text x="{{BRAND_TAG_X}}" y="31" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="{{TAG_SIZE}}" font-weight="600" fill="#E4EAF3">Smarter Business. Greater Growth.</text>
 <text x="0" y="{{KICK_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{KICK_SIZE}}" font-weight="800" letter-spacing="2.4" fill="#FFD45B">ONE PLATFORM. COMPLETE BUSINESS VISIBILITY.</text>
 <text x="0" y="{{HEAD_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{HEAD_SIZE}}" font-weight="850" letter-spacing="-1.2" fill="#fff">ONE PLATFORM.</text>
 <text x="0" y="{{HEAD_Y2}}" font-family="Inter,Arial,sans-serif" font-size="{{HEAD_SIZE}}" font-weight="850" letter-spacing="-1.2" fill="#fff">MULTIPLE WAYS TO</text>
 <text x="0" y="{{HEAD_Y3}}" font-family="Inter,Arial,sans-serif" font-size="{{HEAD_SIZE}}" font-weight="850" letter-spacing="-1.2" fill="#FFD45B">RUN YOUR BUSINESS.</text>
 <text x="0" y="{{SUB_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{SUB_SIZE}}" font-weight="450" fill="#D4DEEB">Manage finances, sales, stock and operations in one connected system.</text>
 <!-- illustrative product panel: explicitly conceptual, not screenshot -->
 <g transform="translate({{PANEL_X}} {{PANEL_Y}})" filter="url(#shadow)" opacity="{{PANEL_OPACITY}}">
  <rect width="{{PANEL_W}}" height="{{PANEL_H}}" rx="20" fill="#fff"/>
  <path d="M20 0h{{PANEL_W_MINUS}}a20 20 0 0 1 20 20v35H0V20A20 20 0 0 1 20 0" fill="#F8FAFD"/>
  <circle cx="24" cy="28" r="5" fill="#E9B844"/><text x="39" y="33" font-family="Inter,Arial,sans-serif" font-size="14" font-weight="700" fill="#233650">BUSINESS OVERVIEW</text>
  <text x="{{PANEL_RIGHT}}" y="33" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="10" font-weight="600" fill="#8794A7">ILLUSTRATIVE VIEW</text>
  <rect x="22" y="73" width="{{WID1}}" height="{{CARDH}}" rx="10" fill="#F5F7FA"/><rect x="{{X2}}" y="73" width="{{WID2}}" height="{{CARDH}}" rx="10" fill="#F5F7FA"/><rect x="{{X3}}" y="73" width="{{WID3}}" height="{{CARDH}}" rx="10" fill="#F5F7FA"/>
  <text x="35" y="98" font-family="Inter,Arial,sans-serif" font-size="10" fill="#758398">INCOME</text><text x="35" y="124" font-family="Inter,Arial,sans-serif" font-size="{{NUMSIZE}}" font-weight="800" fill="#102344">MWK 8.4m</text>
  <text x="{{X2PLUS}}" y="98" font-family="Inter,Arial,sans-serif" font-size="10" fill="#758398">EXPENSES</text><text x="{{X2PLUS}}" y="124" font-family="Inter,Arial,sans-serif" font-size="{{NUMSIZE}}" font-weight="800" fill="#102344">MWK 3.1m</text>
  <text x="{{X3PLUS}}" y="98" font-family="Inter,Arial,sans-serif" font-size="10" fill="#758398">INVOICES</text><text x="{{X3PLUS}}" y="124" font-family="Inter,Arial,sans-serif" font-size="{{NUMSIZE}}" font-weight="800" fill="#102344">24 open</text>
  <text x="24" y="{{CHARTTITLE_Y}}" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="700" fill="#263953">Income &amp; expenses</text>
  <g stroke="#E9EDF2" stroke-width="1"><path d="M25 {{LINE1}}H{{PANEL_RIGHT_MINUS}}M25 {{LINE2}}H{{PANEL_RIGHT_MINUS}}M25 {{LINE3}}H{{PANEL_RIGHT_MINUS}}"/></g>
  <path d="{{CHART1}}" fill="none" stroke="#E5B543" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="{{CHART2}}" fill="none" stroke="#4E80B8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#E5B543"><circle cx="{{DOT1X}}" cy="{{DOT1Y}}" r="4"/><circle cx="{{DOT2X}}" cy="{{DOT2Y}}" r="4"/><circle cx="{{DOT3X}}" cy="{{DOT3Y}}" r="4"/></g>
  <rect x="24" y="{{BADGE_Y}}" width="{{BADGE_W}}" height="30" rx="15" fill="#FFF5D9"/><text x="{{BADGE_TX}}" y="{{BADGE_TY}}" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="700" fill="#875E0C">One platform · Connected operations</text>
 </g>
</g>
<!-- Platform modules -->
<text x="{{PAD}}" y="{{MODULE_TITLE_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{SECTION_SIZE}}" font-weight="800" fill="#142443">ONE PLATFORM. BUILT AROUND YOUR BUSINESS.</text>
<text x="{{PAD}}" y="{{MODULE_SUB_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{SMALL}}" fill="#67768B">A modular system for businesses and organisations at every stage.</text>
{{MODULES}}
<!-- benefits -->
<rect x="{{PAD}}" y="{{BENEFIT_Y}}" width="{{CONTENT_W}}" height="{{BENEFIT_H}}" rx="18" fill="#E8EDF4"/>
<text x="{{PAD_IN}}" y="{{BENEFIT_HEAD_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{BENEFIT_SIZE}}" font-weight="800" fill="#142443">WHY BUSINESSES CHOOSE LEDGR</text>
{{BENEFITS}}
<!-- CTA/footer -->
<rect x="0" y="{{CTA_Y}}" width="{{W}}" height="{{CTA_H}}" fill="url(#navy)"/>
<rect x="0" y="{{CTA_Y}}" width="{{W}}" height="{{CTA_H}}" fill="url(#grid)"/>
<text x="{{PAD}}" y="{{CTA_HEAD_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{CTA_HEAD_SIZE}}" font-weight="850" fill="#fff">TAKE CONTROL OF YOUR</text>
<text x="{{PAD}}" y="{{CTA_HEAD_Y2}}" font-family="Inter,Arial,sans-serif" font-size="{{CTA_HEAD_SIZE}}" font-weight="850" fill="#FFD45B">BUSINESS TODAY.</text>
<rect x="{{PAD}}" y="{{BUTTON_Y}}" width="{{BUTTON_W}}" height="{{BUTTON_H}}" rx="{{BUTTON_R}}" fill="url(#gold)"/>
<text x="{{BUTTON_TEXT_X}}" y="{{BUTTON_TEXT_Y}}" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="{{BUTTON_SIZE}}" font-weight="800" fill="#172540">Book a FREE Ledgr Demonstration</text>
<text x="{{PAD}}" y="{{CTA_SUPPORT_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{FOOT_SIZE}}" fill="#D8E1ED">Discover how Ledgr can simplify your business operations.</text>
<path d="M{{PAD}} {{CONTACT_LINE_Y}}H{{CONTACT_RIGHT}}" stroke="#FFFFFF" stroke-opacity=".22"/>
<text x="{{PAD}}" y="{{PHONE_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{CONTACT_SIZE}}" font-weight="700" fill="#fff">CALL / WHATSAPP</text>
<text x="{{PHONE_X}}" y="{{PHONE_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{CONTACT_SIZE}}" fill="#fff">0881 444 487</text>
<text x="{{PAD}}" y="{{EMAIL_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{CONTACT_SIZE}}" font-weight="700" fill="#fff">EMAIL</text>
<text x="{{EMAIL_X}}" y="{{EMAIL_Y}}" font-family="Inter,Arial,sans-serif" font-size="{{CONTACT_SIZE}}" fill="#fff">gremu.consultancy@gmail.com</text>
<text x="{{PAD}}" y="{{FOOTER_Y}}" opacity="{{FOOTER_OPACITY}}" font-family="Inter,Arial,sans-serif" font-size="{{SMALL}}" fill="#91A1B7">LEDGR  ·  ONE PLATFORM. COMPLETE BUSINESS VISIBILITY. SMARTER DECISIONS.</text>
</svg>
