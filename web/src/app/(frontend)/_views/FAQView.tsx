import { RichText } from '../../../lib/RichText'
import { FAQ_ITEMS } from '../../../lib/faqItems'

// Данные вопросов и ответов живут в lib/faqItems (чистые данные без вёрстки),
// чтобы текст держали юниты: три ответа уже обещали то, чего портал не делает.

export function FAQView() {
  // Группируем по категориям
  const categories = [
    { key: 'general', title: 'Общие вопросы', icon: '❓' },
    { key: 'institutions', title: 'Учреждения культуры', icon: '🏛️' },
    { key: 'education', title: 'Образование и кружки', icon: '🎓' },
    { key: 'museum', title: 'Музей', icon: '🏺' },
    { key: 'festivals', title: 'Праздники', icon: '🎉' },
    { key: 'contacts', title: 'Контакты', icon: '📞' },
  ] as const

  return (
    <section className="faq-section">
      <h1>Часто задаваемые вопросы</h1>
      <p className="muted">Не нашли ответ? Контакты — в конце страницы.</p>

      {categories.map((cat) => {
        const items = FAQ_ITEMS.filter((item) => item.category === cat.key)
        if (items.length === 0) return null

        return (
          <section key={cat.key} className="faq-category">
            <h2 className="faq-category__title">
              <span className="faq-category__icon">{cat.icon}</span>
              {cat.title}
            </h2>
            <dl className="faq-list">
              {items.map((item) => (
                <div key={item.id} className="faq-item">
                  <dt className="faq-question">{item.question}</dt>
                  <dd className="faq-answer">
                    <RichText
                      data={{
                        root: {
                          type: 'root',
                          version: 1,
                          format: '',
                          indent: 0,
                          direction: 'ltr' as const,
                          children: [
                            {
                              type: 'paragraph',
                              version: 1,
                              children: [{ type: 'text', version: 1, text: item.answer }],
                            },
                          ],
                        },
                      }}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )
      })}

      <section className="faq-contacts">
        <h2>📞 Контакты для связи</h2>
        <dl className="contact-list">
          <dt>МКУК «Малмыжский РЦКД»</dt>
          <dd>ул. Чернышевского, 3, г. Малмыж, 612920</dd>
          <dd>Тел.: +7 (83347) 2-22-28</dd>
          <dd>Сайт: malmyzh.ucoz.ru | Портал: <a href="https://культура.вмалмыже.рф" rel="noopener">культура.вмалмыже.рф</a></dd>

          <dt>ДШИ г. Малмыж им. С.Б. Сахара</dt>
          <dd>ул. Чернышевского, 12, г. Малмыж</dd>
          <dd>Тел.: +7 (83347) 2-25-74</dd>
          <dd>Сайт: <a href="https://dshi-malmyzh.ru" rel="noopener">dshi-malmyzh.ru</a></dd>

          <dt>Малмыжский краеведческий музей</dt>
          <dd>ул. Чернышевского, 1, г. Малмыж</dd>
          <dd>Тел.: +7 (83347) 2-25-74</dd>
          <dd>Сайт: <a href="https://vyatkamuseums.ru/malmyzh/o-muzee.html" rel="noopener">vyatkamuseums.ru</a></dd>

          <dt>Администрация Малмыжского района</dt>
          <dd>Сайт: <a href="https://malmyzhskij-r43.gosweb.gosuslugi.ru" rel="noopener">malmyzhskij-r43.gosweb.gosuslugi.ru</a></dd>

          <dt>Праздники района</dt>
          <dd>Сабантуй: <a href="https://сабантуй.вмалмыже.рф" rel="noopener">сабантуй.вмалмыже.рф</a></dd>
          <dd>Казанская ярмарка: <a href="https://казанская.вмалмыже.рф" rel="noopener">казанская.вмалмыже.рф</a></dd>
        </dl>
      </section>
    </section>
  )
}