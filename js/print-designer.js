/* Print designer: keeps the existing settings fields and persistence contract. */
(() => {
  const S = Settings, $ = id => document.getElementById(id);
  const oldLoad = S.loadPrintSettings, oldUpdate = S.updatePrintPreview;
  let baseline = '', zoom = .65, saved = null, request = 0;
  const snapshot = () => JSON.stringify(S.serializePrintForm());
  const dirty = () => { if ($('designerDirty')) $('designerDirty').textContent = snapshot() === baseline ? 'جميع التعديلات محفوظة' : 'تعديلات غير محفوظة'; };
  const group = (title, open = false) => {
    const el = document.createElement('details'); el.className = 'designer-group'; el.open = open;
    const summary = document.createElement('summary'); summary.textContent = title; el.append(summary); return el;
  };
  function init() {
    const form = $('printSettingsForm'); if (!form || form.dataset.designer) return;
    form.dataset.designer = '1';
    const cards = [...form.querySelectorAll(':scope > .print-settings-section-card')];
    const top = document.createElement('div'); top.className = 'designer-controls';
    top.innerHTML = '<label for="designerSearch">اختر المستند أو التقرير</label><input id="designerSearch" class="form-control" placeholder="ابحث عن سند أو تقرير…"><select id="designerDocument" class="form-control" aria-label="نوع المستند"></select><label for="designerTitle">عنوان المستند المختار</label><input id="designerTitle" class="form-control" maxlength="200"><div class="designer-presets"><span>نمط جاهز:</span><button type="button" data-preset="formal">رسمي</button><button type="button" data-preset="simple">مبسط</button><button type="button" data-preset="economy">اقتصادي</button></div>';
    form.prepend(top);
    cards[1].hidden = true;
    const identity = group('1. هوية المؤسسة والترويسة', true), content = group('2. محتوى المستند والأعمدة'), signatures = group('3. التواقيع والتذييل'), page = group('4. إعدادات الورقة والألوان');
    identity.append(cards[2]); cards.slice(3,7).forEach(card => content.append(card)); signatures.append(cards[7]);
    form.insertBefore(identity,cards[0]); form.insertBefore(content,cards[0]); form.insertBefore(signatures,cards[0]); form.insertBefore(page,cards[0]);
    ['printHeaderStyle','printTableDensity','printPageMargins','printOrientation','printBorderStyle','printAccentColor','printFontFamily','printFontSizeScale','printLogoSize'].forEach(id => { const field = $(id)?.closest('.form-group'); if(field)page.append(field); });

    const profiles = group('القوالب المحفوظة'); profiles.append(cards[0]); form.append(profiles);
    const actions = document.createElement('div'); actions.className = 'designer-actions';
    actions.innerHTML = '<span id="designerDirty" role="status"></span><button type="submit" class="btn btn-primary">حفظ وتطبيق</button><button type="button" class="btn btn-secondary" id="designerSaveProfile">حفظ كقالب جديد</button><button type="button" class="btn btn-secondary" onclick="Settings.printCurrentPreviewDoc()">طباعة تجريبية / PDF</button><button type="button" class="btn btn-secondary" id="designerReset">استعادة الافتراضي</button>';
    [...form.children].find(el => el.tagName === 'DIV' && el.querySelector('button[type="submit"]'))?.remove(); form.append(actions);
    $('designerSaveProfile').onclick = () => { profiles.open = true; $('printProfileName').focus(); if($('printProfileName').value.trim())S.savePrintProfile(); };
    $('designerReset').onclick = () => { S.resetDefaultPrintSettings(); selectDocument(); dirty(); };
    $('printDocSwitcher').hidden = true;
    const preview = $('printLivePreviewBox'), toolbar = document.createElement('div'); toolbar.className = 'designer-toolbar';
    toolbar.innerHTML = '<strong>معاينة الورقة A4</strong><select id="designerSource" aria-label="مصدر المعاينة"><option value="demo">بيانات توضيحية</option><option value="saved">سند محفوظ (قبض / صرف)</option></select><select id="designerSaved" hidden aria-label="السند المحفوظ"></select><span id="designerSourceLabel" role="status">بيانات توضيحية — ليست مستندًا ماليًا</span><button type="button" id="designerFit">ملاءمة</button><label>التكبير <select id="designerZoom"><option value=".5">50%</option><option value=".65" selected>65%</option><option value=".8">80%</option><option value="1">100%</option></select></label><label>الصفحة <select id="designerPage" aria-label="الانتقال إلى صفحة"></select></label>';
    preview.before(toolbar); preview.parentElement.querySelector('.print-preview-title-bar').hidden = true;
    function options(filter = '') { const current = $('designerDocument').value || 'receipt'; $('designerDocument').replaceChildren(...SystemCatalog.operations.filter(o=>o.label.includes(filter)).map(o=>new Option(o.label,o.id))); if([...$('designerDocument').options].some(o=>o.value===current))$('designerDocument').value=current; }
    options(); $('designerSearch').oninput = e => { options(e.target.value.trim()); selectDocument(); };
    $('designerDocument').onchange = selectDocument;
    $('designerTitle').oninput = e => { const field = $('operationTitle_'+$('designerDocument').value); if(field)field.value=e.target.value; S.updatePrintPreview(); dirty(); };
    top.querySelectorAll('[data-preset]').forEach(button => button.onclick = () => {
      const economy=button.dataset.preset==='economy', simple=button.dataset.preset==='simple';
      const values={printAccentColor:economy?'#000000':simple?'#0f2744':'#d4af37',printBorderStyle:simple?'minimal':'classic',printTableDensity:economy?'compact':'medium',printPageMargins:'normal',printHeaderStyle:'dynamic'};
      Object.entries(values).forEach(([id,value])=>{const el=$(id);if(el && (el.tagName!=='SELECT'||[...el.options].some(o=>o.value===value)))el.value=value;}); S.updatePrintPreview(); dirty();
    });
    $('designerSource').onchange = loadSaved; $('designerSaved').onchange = () => { saved=S._designerRecords?.find(r=>String(r.id)===$('designerSaved').value)||null; S.updatePrintPreview(); };
    $('designerZoom').onchange = e => { zoom=Number(e.target.value); scale(); };
    $('designerFit').onclick = () => { zoom=Math.min(1,(preview.clientWidth-24)/( $('printOrientation').value==='landscape'?1123:794)); scale(); };
    $('designerPage').onchange=e=>preview.querySelectorAll('.designer-paper')[Number(e.target.value)]?.scrollIntoView({block:'nearest',behavior:'smooth'});
    form.addEventListener('input',dirty); form.addEventListener('change',dirty);
    selectDocument();
  }
  function selectDocument() {
    const id=$('designerDocument').value; if(!id)return;
    $('designerTitle').value=$('operationTitle_'+id)?.value||''; $('designerTitle').placeholder=SystemCatalog.operations.find(o=>o.id===id)?.label||'';
    saved=null; request++; if($('designerSource').value==='saved')loadSaved(); else render();
  }
  async function loadSaved() {
    const token=++request, id=$('designerDocument').value; saved=null;
    $('designerSaved').hidden=$('designerSource').value!=='saved';
    if($('designerSource').value==='demo'){render();return;}
    if(!['receipt','expense'].includes(id)){$('designerSourceLabel').textContent='المستندات المحفوظة متاحة حاليًا لسندات القبض والصرف. اختر البيانات التوضيحية لبقية النماذج.'; $('designerSaved').replaceChildren();render();return;}
    $('designerSourceLabel').textContent='جارٍ تحميل السندات المسموح بعرضها…'; render();
    try {
      const response=await fetch(id==='receipt'?'/api/payments?type='+encodeURIComponent('قبض'):'/api/expenses'); const json=await response.json(); if(token!==request)return;
      if(!response.ok||!json.success)throw new Error(json.message||'تعذر تحميل السندات أو لا تملك صلاحية عرضها');
      S._designerRecords=Array.isArray(json.data)?json.data:[];
      $('designerSaved').replaceChildren(new Option('اختر سندًا محفوظًا',''),...S._designerRecords.map(r=>new Option((r.receipt_no||r.id)+' — '+(r.date||''),r.id)));
      $('designerSourceLabel').textContent=S._designerRecords.length?'اختر سندًا — معاينة بيانات محفوظة دون تعديلها':'لا توجد سندات متاحة'; render();
    } catch(error){if(token!==request)return;$('designerSourceLabel').textContent=error.message;render();}
  }
  function scale(){const paper=$('printLivePreviewBox')?.firstElementChild;if(paper){paper.style.zoom=zoom;}}
  function render() {
    if(!$('designerDocument'))return;
    $('designerTitle').value=$('operationTitle_'+$('designerDocument').value)?.value||'';
    const id=$('designerDocument').value, legacy={income_statement:'profit_loss',project_profitability:'project'};
    S._previewDocType=legacy[id]||id;
    const supported=['receipt','expense','custody','journal','cash_movement','client_stmt','supplier_stmt','project','contract','ipc','quotation','change_order','daily_report','handover','payroll','profit_loss','balance_sheet','cash_flow','trial_balance','inventory'];
    if(!supported.includes(S._previewDocType))S._previewDocType='operation:'+id;
    // Use every live setting for generic document renderers too.
    const original=S.getPrintConfig; S.getPrintConfig=()=>liveConfig(original.call(S));
    try { oldUpdate.call(S); } finally {S.getPrintConfig=original;}
    const box=$('printLivePreviewBox');
    if($('designerSource').value==='saved') {
      box.innerHTML=saved?'<div>'+S.renderReportHeader($('designerTitle').value||$('designerTitle').placeholder,[],liveConfig(S.getPrintConfig()))+'<p>معاينة سند محفوظ — '+S.escapeText(saved.receipt_no||saved.id)+'</p><table class="official-report-table"><tbody>'+[['التاريخ',saved.date],['الاسم',saved.client_name||saved.supplier_name||saved.beneficiary],['المشروع',saved.project_name],['البيان',saved.description||saved.notes],['المبلغ',Number(saved.amount||0).toLocaleString('en-US')+' '+(saved.currency||'')],['الحالة',saved.status]].map(([label,value])=>'<tr><th>'+label+'</th><td>'+S.escapeText(value??'—')+'</td></tr>').join('')+'</tbody></table>'+S.renderReportSignatures(liveConfig(S.getPrintConfig()))+S.renderReportFooter(liveConfig(S.getPrintConfig()))+'</div>':'<div><p>اختر سندًا محفوظًا من القائمة لعرضه هنا.</p></div>';
      if(saved)$('designerSourceLabel').textContent='بيانات سند محفوظ — '+(saved.receipt_no||saved.id);
    } else $('designerSourceLabel').textContent='بيانات توضيحية — ليست مستندًا ماليًا';
    const paper=box.firstElementChild;if(!paper)return;
    paper.classList.add('designer-paper');paper.style.filter=$('printAccentColor').value==='#000000'?'grayscale(1)':'none';
    const landscape=$('printOrientation').value==='landscape',margin={narrow:6,normal:12,wide:18}[$('printPageMargins').value]||12;
    paper.style.width=landscape?'297mm':'210mm';paper.style.minHeight=landscape?'210mm':'297mm';paper.style.padding=margin+'mm';paper.style.fontFamily=$('printFontFamily').value;
    // The original individual preview titles are separate fields. The chosen override wins.
    const heading=paper.querySelector('.doc-badge,.report-title,.official-report-title,.voucher-title');if(heading&&$('designerTitle').value)heading.textContent=$('designerTitle').value;
    paginate(paper);scale();dirty();
  }
  function paginate(paper){
    paper.style.zoom='1';
    const height=parseFloat(paper.style.minHeight)*96/25.4;
    const nodes=[...paper.childNodes], stack=document.createElement('div');stack.className='designer-pages';paper.replaceWith(stack);
    function next(){const el=paper.cloneNode(false);el.style.minHeight=paper.style.minHeight;el.style.zoom='1';stack.append(el);return el;}
    let current=next();const fits=()=>current.scrollHeight<=height+1;
    for(const node of nodes){
      if(node.nodeType===1 && node.tagName==='TABLE' && node.tBodies.length){
        let table=node.cloneNode(false);if(node.tHead)table.append(node.tHead.cloneNode(true));let body=document.createElement('tbody');table.append(body);current.append(table);
        for(const row of [...node.tBodies].flatMap(b=>[...b.rows])){body.append(row);if(!fits()&&body.rows.length>1){row.remove();current=next();table=node.cloneNode(false);if(node.tHead)table.append(node.tHead.cloneNode(true));body=document.createElement('tbody');table.append(body);current.append(table);body.append(row);}}
        if(node.tFoot)table.append(node.tFoot.cloneNode(true));
      }else{current.append(node);if(!fits()&&current.childNodes.length>1){node.remove();current=next();current.append(node);}}
    }
    $('designerPage').replaceChildren(...[...stack.children].map((_,i)=>new Option((i+1)+' / '+stack.children.length,i)));
  }
  function liveConfig(cfg){
    const map={header_title:'printHeaderTitle',header_en:'printHeaderEn',header_subtitle:'printHeaderSubtitle',tax_no:'printTaxNo',slogan:'printSlogan',header_style:'printHeaderStyle',table_density:'printTableDensity',border_style:'printBorderStyle',accent_color:'printAccentColor',sig_position:'printSigPosition',logo_size:'printLogoSize',font_family:'printFontFamily',font_size_scale:'printFontSizeScale',sig1:'printSig1',sig2:'printSig2',sig3:'printSig3',footer_notes:'printFooterNotes',show_logo:'printShowLogo',show_stamp:'printShowStamp',show_page_numbers:'printShowPageNumbers',show_print_time:'printShowPrintTime'};
    const result={...cfg,operation_titles:S.operationTitles()};Object.entries(map).forEach(([key,id])=>{const el=$(id);if(el)result[key]=el.type==='checkbox'?(el.checked?'1':'0'):el.value;});return result;
  }
  S.updatePrintPreview=function(){if($('printSettingsForm')?.dataset.designer)render();else oldUpdate.call(S);};
  S.loadPrintSettings=async function(){await oldLoad.apply(S,arguments);init();baseline=snapshot();dirty();};
  S.designerMarkSaved=()=>{baseline=snapshot();dirty();};
  S.printCurrentPreviewDoc=function(){
    if($('designerSource')?.value==='saved'&&!saved)return App.showToast('اختر سندًا محفوظًا أولًا','error');
    const content=$('printLivePreviewBox')?.firstElementChild?.cloneNode(true);if(!content)return;content.style.zoom='1';
    const win=window.open('','_blank');if(!win)return App.showToast('اسمح بفتح نافذة الطباعة في المتصفح','error');
    win.document.write('<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>معاينة الطباعة</title><link rel="stylesheet" href="'+new URL('css/style.css',location.href).href+'"><style>@page{size:A4 '+($('printOrientation').value==='landscape'?'landscape':'portrait')+';margin:0}body{margin:0;background:white!important}.designer-paper{box-shadow:none!important;margin:0!important;break-after:page}.designer-paper:last-child{break-after:auto}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body>'+content.outerHTML+'</body></html>');win.document.close();win.onload=async()=>{await win.document.fonts.ready;win.print();};
  };
})();
