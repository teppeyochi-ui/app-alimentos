import streamlit as st
import pandas as pd
from openai import OpenAI
import base64
import json
from datetime import datetime

# --- Configuração da Página (Modo Mobile) ---
st.set_page_config(page_title="App Produtos Frescatto", layout="wide", initial_sidebar_state="collapsed")

# --- CSS para melhorar visual no celular ---
st.markdown("""
    <style>
    .stButton>button {width: 100%; border-radius: 20px; height: 3em;}
    div[data-testid="stExpander"] details summary p {font-size: 1.1rem; font-weight: bold;}
    </style>
    """, unsafe_allow_html=True)

# --- Cabeçalho ---
st.title("🐟 Gestão de P&D")
st.caption("Captura de Dados via IA - Frescatto/Parceiros")

# --- Configuração da API Key (Lateral) ---
with st.sidebar:
    st.header("Configurações")
    # Tenta pegar dos 'secrets' do Streamlit Cloud, senão pede na tela
    if 'OPENAI_API_KEY' in st.secrets:
        api_key = st.secrets['OPENAI_API_KEY']
        st.success("Chave de API carregada do sistema.")
    else:
        api_key = st.text_input("Cole sua OpenAI API Key:", type="password")

# --- Funções do Sistema ---
def encode_image(image_file):
    return base64.b64encode(image_file.read()).decode('utf-8')

def analisar_produto(imagens, key):
    client = OpenAI(api_key=key)
    
    prompt_text = """
    Analise estas fotos de embalagem de alimento. 
    Objetivo: Engenharia reversa para cadastro técnico.
    
    Extraia e retorne APENAS um JSON com estes campos exatos:
    {
        "nome_tecnico": "Nome exato do produto",
        "marca": "Marca comercial",
        "peso_liquido": "Ex: 500g",
        "fabricante": "Razão Social ou Nome",
        "tabela_nutricional": [
             {"item": "Valor Energético", "qtd": "valor", "vd": "%"},
             {"item": "Carboidratos", "qtd": "valor", "vd": "%"},
             {"item": "Proteínas", "qtd": "valor", "vd": "%"},
             {"item": "Sódio", "qtd": "valor", "vd": "%"}
        ],
        "ingredientes_texto": "Texto completo dos ingredientes",
        "conservacao": "Ex: Manter congelado a -12C",
        "contatos": "SAC, Email ou Telefone"
    }
    Se a imagem estiver ruim, tente inferir pelo contexto ou deixe null.
    """

    content = [{"type": "text", "text": prompt_text}]
    
    for img in imagens:
        base64_img = encode_image(img)
        content.append({
            "type": "image_url", 
            "image_url": {"url": f"data:image/jpeg;base64,{base64_img}"}
        })

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": content}],
        response_format={"type": "json_object"},
        max_tokens=1500
    )
    return json.loads(response.choices[0].message.content)

# --- Interface Principal ---

# 1. Upload de Fotos
st.info("Passo 1: Tire fotos da embalagem (Frente, Verso, Tabela)")
uploaded_files = st.file_uploader("", accept_multiple_files=True, type=['jpg', 'png', 'jpeg'])

if 'dados' not in st.session_state:
    st.session_state.dados = None

# 2. Botão de Processamento
if uploaded_files and api_key:
    if st.button("🚀 Processar com IA"):
        with st.spinner("Lendo embalagens..."):
            try:
                st.session_state.dados = analisar_produto(uploaded_files, api_key)
                st.success("Leitura concluída!")
            except Exception as e:
                st.error(f"Erro: {e}")

# 3. Exibição e Edição
if st.session_state.dados:
    d = st.session_state.dados
    
    with st.form("ficha_tecnica"):
        st.subheader("📝 Ficha Técnica")
        
        # Campos principais
        col1, col2 = st.columns(2)
        with col1:
            nome = st.text_input("Produto", d.get('nome_tecnico'))
            marca = st.text_input("Marca", d.get('marca'))
            peso = st.text_input("Peso", d.get('peso_liquido'))
        with col2:
            fab = st.text_input("Fabricante", d.get('fabricante'))
            cons = st.text_input("Conservação", d.get('conservacao'))
            sac = st.text_input("Contatos", d.get('contatos'))
        
        st.write("**Ingredientes:**")
        ing = st.text_area("Ingredientes", d.get('ingredientes_texto'), height=100)
        
        st.write("**Tabela Nutricional:**")
        df_nutri = pd.DataFrame(d.get('tabela_nutricional', []))
        if df_nutri.empty: 
            df_nutri = pd.DataFrame(columns=["item", "qtd", "vd"])
        
        tabela_final = st.data_editor(df_nutri, use_container_width=True, num_rows="dynamic")
        
        # Botão Salvar
        enviou = st.form_submit_button("💾 Gravar Registro")
        
        if enviou:
            registro = {
                "Data": datetime.now().strftime("%d/%m/%Y %H:%M"),
                "Produto": nome,
                "Marca": marca,
                "Peso": peso,
                "Fabricante": fab,
                "Ingredientes": ing,
                "Tabela_JSON": tabela_final.to_json()
            }
            
            # ATENÇÃO: Em Web App gratuito, arquivos locais resetam. 
            # O ideal é salvar num banco externo ou permitir download imediato.
            df_novo = pd.DataFrame([registro])
            
            # Converte para CSV para download imediato no celular
            csv = df_novo.to_csv(index=False).encode('utf-8')
            
            st.success("Produto processado!")
            st.download_button(
                label="📥 Baixar Registro (CSV)",
                data=csv,
                file_name=f"produto_{nome}.csv",
                mime="text/csv"
            )
            # Aqui você poderia adicionar código para enviar para Google Sheets
