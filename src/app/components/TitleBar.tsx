import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { message, theme } from 'antd';
import {
  BorderOutlined,
  CloseOutlined,
  FullscreenExitOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

const TITLEBAR_HEIGHT_PX = 44;

export function TitleBar() {
  const {
    token: {
      colorText,
      colorTextSecondary,
      colorBgLayout,
      colorBorderSecondary,
      colorFillTertiary,
    },
  } = theme.useToken();

  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        setIsMaximized(await appWindow.isMaximized());
      } catch {
        // noop (e.g. running in a plain browser)
      }
    })();
  }, []);

  const minimize = useCallback(() => {
    void (async () => {
      try {
        const win = getCurrentWindow();
        await win.minimize();
      } catch (err) {
        console.error('Failed to minimize window', err);
        message.error('Failed to minimize window');
      }
    })();
  }, []);

  const toggleMaximize = useCallback(() => {
    void (async () => {
      try {
        const win = getCurrentWindow();
        const currentlyMaximized = await win.isMaximized();
        if (currentlyMaximized) {
          await win.unmaximize();
          setIsMaximized(false);
        } else {
          await win.maximize();
          setIsMaximized(true);
        }
      } catch (err) {
        console.error('Failed to toggle maximize window', err);
        message.error('Failed to toggle maximize/restore');
      }
    })();
  }, []);

  const close = useCallback(() => {
    void (async () => {
      try {
        const win = getCurrentWindow();
        await win.close();
      } finally {
        // Ensure the process exits (premium desktop behavior).
        try {
          await invoke('quit_app');
        } catch (err) {
          console.error('Failed to exit app', err);
          message.error('Failed to close application');
        }
      }
    })();
  }, []);

  const buttonBaseStyle: CSSProperties = {
    height: TITLEBAR_HEIGHT_PX,
    width: TITLEBAR_HEIGHT_PX,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'transparent',
    color: colorTextSecondary,
    cursor: 'pointer',
    borderRadius: 6,
    pointerEvents: 'auto',
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        height: TITLEBAR_HEIGHT_PX,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        background: colorBgLayout,
        borderBottom: `1px solid ${colorBorderSecondary}`,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 120,
          color: colorText,
          fontWeight: 600,
        }}
      >
        Pausaler
      </div>

      <div style={{ flex: 1 }} />

      <div
        data-tauri-drag-region="false"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          position: 'relative',
          zIndex: 1,
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          aria-label="Minimize"
          data-tauri-drag-region="false"
          onClick={minimize}
          style={buttonBaseStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colorFillTertiary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <MinusOutlined />
        </button>

        <button
          type="button"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          data-tauri-drag-region="false"
          onClick={toggleMaximize}
          style={buttonBaseStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colorFillTertiary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {isMaximized ? <FullscreenExitOutlined /> : <BorderOutlined />}
        </button>

        <button
          type="button"
          aria-label="Close"
          data-tauri-drag-region="false"
          onClick={close}
          style={buttonBaseStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colorFillTertiary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <CloseOutlined />
        </button>
      </div>
    </div>
  );
}

export const TITLEBAR_HEIGHT = TITLEBAR_HEIGHT_PX;
