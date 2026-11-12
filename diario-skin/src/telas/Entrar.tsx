// Entrada: e-mail e senha, ou link/código enviado por e-mail. Quem cria conta
// espera o administrador liberar o acesso.

import { useState, type FormEvent } from 'react';
import { MAQUINA } from '../lib/constantes';
import type { Perfil } from '../lib/tipos';
import { criarConta, entrarComCodigo, entrarComSenha, pedirLink, sair, verificarLiberacao } from '../lib/sessao';

type Modo = 'entrar' | 'criar' | 'link';

function Marca() {
  return (
    <div>
      <div className="eyebrow">Frescatto · P&D · {MAQUINA}</div>
      <h1>Diário da Linha Skin</h1>
    </div>
  );
}

export function Entrar() {
  const [modo, setModo] = useState<Modo>('entrar');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [linkEnviado, setLinkEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'bad' | 'ok'; texto: string } | null>(null);

  function trocar(m: Modo) {
    setModo(m);
    setMsg(null);
    setLinkEnviado(false);
    setCodigo('');
  }

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setMsg(null);
    try {
      if (modo === 'entrar') {
        const erro = await entrarComSenha(email, senha);
        if (erro) setMsg({ tipo: 'bad', texto: erro });
      } else if (modo === 'criar') {
        if (senha.length < 8) { setMsg({ tipo: 'bad', texto: 'Use uma senha com pelo menos 8 caracteres.' }); return; }
        const r = await criarConta(nome, email, senha);
        if (r.erro) setMsg({ tipo: 'bad', texto: r.erro });
        else if (r.confirmar) {
          setMsg({ tipo: 'ok', texto: 'Conta criada. Abra o e-mail que enviamos e toque no link para confirmar; depois volte aqui e entre.' });
          setModo('entrar');
        }
      } else if (!linkEnviado) {
        const erro = await pedirLink(email, nome);
        if (erro) setMsg({ tipo: 'bad', texto: erro });
        else {
          setLinkEnviado(true);
          setMsg({ tipo: 'ok', texto: 'E-mail enviado. Toque no link da mensagem ou digite aqui o código de 6 dígitos, se ele vier no e-mail.' });
        }
      } else {
        const erro = await entrarComCodigo(email, codigo);
        if (erro) setMsg({ tipo: 'bad', texto: erro });
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="wrap entrar">
      <Marca />
      <div className="card">
        <h2>{modo === 'entrar' ? 'Entrar' : modo === 'criar' ? 'Criar conta' : 'Entrar por e-mail'}</h2>
        <form onSubmit={(ev) => void enviar(ev)}>
          {modo !== 'entrar' && !linkEnviado && (
            <label>
              Seu nome
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required={modo === 'criar'} />
            </label>
          )}
          <label>
            E-mail
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" required disabled={linkEnviado} />
          </label>
          {modo !== 'link' && (
            <label>
              Senha
              <input
                type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
                autoComplete={modo === 'criar' ? 'new-password' : 'current-password'}
              />
            </label>
          )}
          {modo === 'link' && linkEnviado && (
            <label>
              Código do e-mail
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
            </label>
          )}
          {msg && <div className={`notice ${msg.tipo}`} role={msg.tipo === 'bad' ? 'alert' : 'status'}>{msg.texto}</div>}
          <button type="submit" className="primary" disabled={ocupado}>
            {ocupado ? 'Aguarde…'
              : modo === 'entrar' ? 'Entrar'
              : modo === 'criar' ? 'Criar conta'
              : linkEnviado ? 'Entrar com o código' : 'Enviar link para o e-mail'}
          </button>
        </form>
        <div className="row">
          {modo !== 'entrar' && <button type="button" className="ghost" onClick={() => trocar('entrar')}>Entrar com senha</button>}
          {modo !== 'link' && <button type="button" className="ghost" onClick={() => trocar('link')}>Entrar sem senha (link por e-mail)</button>}
          {modo !== 'criar' && <button type="button" className="ghost" onClick={() => trocar('criar')}>Criar conta</button>}
        </div>
        <p className="small muted">
          Conta nova precisa ser liberada pelo administrador do P&D antes do primeiro uso.
          O primeiro acesso precisa de internet; depois o aplicativo funciona sem sinal.
        </p>
      </div>
    </main>
  );
}

export function AguardandoLiberacao({ perfil }: { perfil: Perfil }) {
  const [verificando, setVerificando] = useState(false);
  return (
    <main className="wrap entrar">
      <Marca />
      <div className="card">
        <h2>Aguardando liberação</h2>
        <p>
          Olá, {perfil.nome}. Sua conta foi criada, mas ainda não está liberada.
          Peça ao administrador do P&D para ativar seu usuário em Administração → Usuários.
        </p>
        <div className="row">
          <button
            type="button" className="primary" disabled={verificando}
            onClick={() => { setVerificando(true); void verificarLiberacao().finally(() => setVerificando(false)); }}
          >
            {verificando ? 'Verificando…' : 'Já fui liberado'}
          </button>
          <button type="button" onClick={() => void sair()}>Sair</button>
        </div>
      </div>
    </main>
  );
}
