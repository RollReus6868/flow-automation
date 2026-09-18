#!/usr/bin/env python3
"""Minimal Native Messaging host for Flow Automation Local.
Only supports ping, shutdown and cancel_shutdown. No arbitrary command execution.
"""
import json, struct, subprocess, sys

def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) != 4:
        return None
    length = struct.unpack('<I', raw)[0]
    payload = sys.stdin.buffer.read(length)
    if len(payload) != length:
        return None
    return json.loads(payload.decode('utf-8'))

def send(obj):
    data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

def main():
    while True:
        msg = read_message()
        if msg is None:
            break
        action = msg.get('action')
        try:
            if action == 'ping':
                send({'success': True, 'message': 'pong'})
            elif action == 'shutdown':
                delay = int(msg.get('delay', 60))
                delay = max(10, min(delay, 3600))
                subprocess.run(['shutdown', '/s', '/t', str(delay)], check=False, creationflags=0x08000000)
                send({'success': True, 'message': f'shutdown scheduled in {delay}s'})
            elif action == 'cancel_shutdown':
                subprocess.run(['shutdown', '/a'], check=False, creationflags=0x08000000)
                send({'success': True, 'message': 'shutdown cancelled'})
            else:
                send({'success': False, 'error': 'unsupported action'})
        except Exception as exc:
            send({'success': False, 'error': str(exc)})

if __name__ == '__main__':
    main()
