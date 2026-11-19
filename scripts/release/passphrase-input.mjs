import { createInterface } from 'node:readline';

const readHidden = prompt =>
  new Promise((resolve, reject) => {
    const { stdin, stderr } = process;
    let value = '';
    stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = callback => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      callback();
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003') return finish(() => reject(new Error('취소되었습니다.')));
        if (character === '\r' || character === '\n') return finish(() => resolve(value));
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
      }
    };
    stdin.on('data', onData);
  });

const readLine = async () => {
  const reader = createInterface({ input: process.stdin });
  for await (const line of reader) {
    reader.close();
    return line;
  }
  return '';
};

// Refuses non-TTY input unless explicitly piped, since mintty or IDE consoles would echo the passphrase.
export const assertPassphraseInput = ({ interactive, allowStdin }) => {
  if (interactive || allowStdin) return;
  throw new Error(
    '비밀번호를 숨겨서 입력할 수 있는 터미널이 아닙니다. PowerShell 이나 Windows Terminal 에서 실행하세요. ' +
      '파이프로 비밀번호를 넘기는 경우에만 PTB_PASSPHRASE_STDIN=1 을 설정하세요.',
  );
};

// Reads the passphrase from a hidden TTY prompt, or one stdin line when PTB_PASSPHRASE_STDIN=1; never from argv.
export const readPassphrase = async (prompt = '서명 키 비밀번호: ') => {
  const interactive = Boolean(process.stdin.isTTY);
  assertPassphraseInput({ interactive, allowStdin: process.env.PTB_PASSPHRASE_STDIN === '1' });
  const value = interactive ? await readHidden(prompt) : await readLine();
  const passphrase = value.trim();
  if (!passphrase) throw new Error('비밀번호가 비어 있습니다.');
  return passphrase;
};
