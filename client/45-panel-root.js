    function MemoryPanel() {
      const [tab, setTab] = useState('memory');
      return h(
        'div',
        { className: 'shl-app' },
        h(
          'div',
          { className: 'shl-head' },
          h('p', { className: 'shl-kicker' }, 'Shoreline'),
          h('h3', { className: 'shl-title' }, TABS.find((item) => item.key === tab)?.title ?? '记忆'),
          h('p', { className: 'shl-sub' }, TABS_SUB[tab] ?? ''),
        ),
        h(
          'div',
          { className: 'shl-tabs' },
          TABS.map((item) =>
            h(
              'button',
              {
                key: item.key,
                className: `shl-tab${tab === item.key ? ' on' : ''}`,
                disabled: item.disabled,
                title: item.disabled ? item.hint : undefined,
                onClick: item.disabled ? undefined : () => setTab(item.key),
              },
              item.label,
            ),
          ),
        ),
        tab === 'mood'
          ? h(MoodBody)
          : tab === 'voice'
            ? h(VoiceBody)
            : tab === 'bridge'
              ? h(BridgeBody)
              : tab === 'qzone'
                ? h(QzoneBody)
                : tab === 'bili'
                ? h(BiliBody)
                : tab === 'purpose'
                  ? h(PurposeBody)
                  : tab === 'fish'
                    ? h(FishBody)
                    : h(MemoryBody),
      );
    }
