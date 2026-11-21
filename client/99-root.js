    const inject = ['slots'];
    const NS = 'shoreline';

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: NS, order: 8, label: () => 'Shoreline' },
              MemoryPanel,
            ),
          ),
        'shoreline: settings section',
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.MemoryPanel = MemoryPanel;
    return module.exports;
  },
});
