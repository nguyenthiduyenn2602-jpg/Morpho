import React, { useEffect, useRef, useState } from 'react';
import './LawHotline.css';

export default function LawHotline({ onClose, submissionUrl }: { onClose?: () => void; submissionUrl?: string }) {
    const [page, setPage] = useState<'home' | 'write' | 'review'>('home');
    const [title, setTitle] = useState('');
    const [story, setStory] = useState('');
    const [question, setQuestion] = useState('');
    const [email, setEmail] = useState('');
    const [age, setAge] = useState('');
    const [gender, setGender] = useState('');
    const [occupation, setOccupation] = useState('');
    const [consent, setConsent] = useState(false);
    const [notice, setNotice] = useState('');
    const [sending, setSending] = useState(false);
    const [receipt, setReceipt] = useState('');
    const busy = useRef(false);
    const requestIdentity = useRef({signature: '', id: ''});
    const scroll = useRef<HTMLDivElement>(null);
    useEffect(() => { scroll.current?.scrollTo(0, 0); setNotice(''); }, [page]);
    const changePage = (next: typeof page) => { if (busy.current) return; if (receipt) { requestIdentity.current = {signature: '', id: ''}; setTitle(''); setStory(''); setQuestion(''); setEmail(''); setAge(''); setGender(''); setOccupation(''); setReceipt(''); setConsent(false); setPage('home'); return; } setConsent(false); setPage(next); };
    const send = async () => {
        if (!consent || busy.current || receipt) return;
        if (!submissionUrl) { setNotice('尚未接入收件服务，文字未发送。'); return; }
        busy.current = true; setSending(true); setNotice('正在发送并等待后台保存确认……');
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45000);
        try {
            const signature = JSON.stringify([title,story,question,email,age,gender,occupation]);
            if (requestIdentity.current.signature !== signature) requestIdentity.current = {signature, id: crypto.randomUUID()};
            const data = new FormData();
            data.set('requestId', requestIdentity.current.id);
            Object.entries({title, story, question, email, age, gender, occupation, consent: 'yes'}).forEach(([k,v]) => data.set(k,v));
            const response = await fetch(submissionUrl, {method: 'POST', body: data, signal: controller.signal});
            const result = await response.json();
            if (!response.ok || !result.id) throw new Error(result.error || '后台未确认保存');
            setReceipt(result.id); setNotice(`投稿已保存。编号：${result.id}`);
        } catch (error) {
            setNotice(`未能确认送达，填写内容仍在。${error instanceof Error && error.name !== 'AbortError' ? error.message : '连接超时或中断'}。请先核对后台是否收到，再重试，避免重复投稿。`);
        } finally { clearTimeout(timer); busy.current = false; setSending(false); }
    };
    return <div className="law-hotline">
        <header className="law-top"><button aria-label={page === 'home' ? '返回小手机' : '返回上一步'} disabled={page === 'home' && !onClose} onClick={() => page === 'home' ? onClose?.() : changePage(page === 'review' ? 'write' : 'home')}>←</button><span>Morpho热线</span><small>免费投稿</small></header>
        <div className="law-scroll" ref={scroll}>
            <div className="law-demo">{submissionUrl ? (submissionUrl.startsWith('http://127.0.0.1:') ? '本机收发测试 · 仅使用虚构材料 · 提交后保存在本机后台' : '投稿将保存到热线云端后台 · 不读取其他小手机数据') : '界面预览 · 不发送、不统计 · 刷新后填写内容不保留'}</div>
            {page === 'home' ? <>
                <section className="law-hero">
                    <div className="law-eyebrow"><span /> MORPHO · 来信栏目</div>
                    <div className="law-issue">让那些说不清的委屈<br />有一个开口的地方。</div>
                    <h1>大壮<br /><em>法律热线</em><span className="law-star">✳</span></h1>
                    <p>不舒服的规则，<br />也值得被认真问一问。</p>
                    <div className="law-ticket"><span>不用先懂法律</span><span>也不用组织好一切</span><button onClick={() => changePage('write')}>写给大壮 ↗</button></div>
                </section>
                <section className="law-section"><div className="law-label">01 / 什么都可以先聊聊</div><h2>从一件让你在意的事开始</h2><p>一条不太公平的规定、一段难以理解的经历，或成长中的一点迷茫。问题不必严格属于法律，也不必足够“严重”。</p><div className="law-chips"><span>不舒服的规则</span><span>生活里的困扰</span><span>成长中的迷茫</span></div></section>
                <section className="law-section law-boundary"><div className="law-label">02 / 先把这件事说清楚</div><h2>这是一份投稿</h2><p>大壮可能选取来信，在隐去真实姓名、联系方式等可识别信息后，整理成视频、直播讨论或切片，为遇到相似困境的人提供帮助。</p><p><strong>不保证逐一回复，也不保证被选用。</strong>如果期待回信，可以自愿留下邮箱。</p><p><strong>投稿可能由 AI 辅助阅读和整理。</strong>请认真描述你想讨论的问题，避免无意义刷屏、恶意辱骂或恐吓。请珍惜这个免费交流的空间，也保护作者建设热线、帮助他人的初心。</p><p>提交的文字、背景信息和选填邮箱将保存到热线后台，仅供管理员查看与处理，使用云端存储。未提交的填写内容刷新后不保留。</p><p>特殊经历和细节仍可能被熟人认出。不适合公开讨论的材料，请不要通过本栏目投稿。</p></section>
                <section className="law-section law-note"><span>✉</span><div><h2>一封来信，也是一点勇气</h2><p>年龄、性别与职业仅作为理解投稿的背景，不用于用户画像或统计。不要求真实姓名，也不读取你的角色、聊天记录和其他相册内容。</p></div></section>
                <div className="law-bottom"><button className="law-primary" onClick={() => changePage('write')}>写一封投稿 <span>↗</span></button><p>免费留言 · 非即时热线 · 不代表接受案件委托</p></div>
            </> : page === 'write' ? <>
                <section className="law-form-head"><div className="law-label">YOUR LETTER / 写给大壮</div><h1>慢慢说，<br />从这里开始。</h1><p>第一版仅接收文字，不支持图片、视频或文件附件。尽量使用化名，只写理解问题必需的信息。</p></section>
                <form className="law-form" onSubmit={e => { e.preventDefault(); changePage('review'); }}>
                    <fieldset className="law-background"><legend>先补充一点背景</legend><p>有些问题需要结合年龄、性别和职业理解。请按实际情况填写，不需要真实姓名、单位名称或其他身份凭证；这些信息不用于统计。</p><div className="law-background-row"><label>年龄 <i>必填</i><input type="number" min="1" max="120" step="1" required value={age} onChange={e => setAge(e.target.value)} placeholder="周岁" /></label><label>性别 <i>必填</i><input required maxLength={30} value={gender} onChange={e => setGender(e.target.value)} placeholder="按实际情况填写" /></label></div><label>职业／目前状态 <i>必填</i><input required maxLength={80} value={occupation} onChange={e => setOccupation(e.target.value)} placeholder="如：学生、职员、自由职业、待业" /></label></fieldset>
                    <label>给这封来信起个标题 <i>必填</i><input required maxLength={80} value={title} onChange={e => setTitle(e.target.value)} placeholder="比如：这条规定，我总觉得哪里不对" /></label>
                    <label>发生了什么？<i>必填</i><textarea required maxLength={6000} rows={7} value={story} onChange={e => setStory(e.target.value)} placeholder="事情大概是这样的……可以按时间顺序慢慢写，不需要法律术语。" /><small>{story.length} / 6000</small></label>
                    <label>你最想问大壮什么？<i>选填</i><textarea maxLength={1000} rows={3} value={question} onChange={e => setQuestion(e.target.value)} placeholder="想弄明白的规则、纠结的选择，或希望得到的帮助。" /></label>
                    <label>希望收到回信？<i>邮箱选填</i><input type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="你的邮箱地址" /><p className="law-field-note">仅用于本次投稿联系，不公开展示。留空也可以投稿；填写不代表一定收到回复。</p></label>
                    <div role="status" className="law-status">{notice}</div>
                    <button className="law-primary" type="submit">下一步，检查投稿 <span>→</span></button><p className="law-footnote">这一步不会发送，提交前还会再次确认。</p>
                </form>
            </> : <>
                <section className="law-form-head"><div className="law-label">BEFORE YOU SEND / 最后检查一次</div><h1>把问题寄出，<br />把隐私留好。</h1></section>
                <section className="law-letter"><span className="law-label">投稿预览</span><h2>{title}</h2><div className="law-background-summary">背景：{age} 岁 · {gender} · {occupation}</div><p>{story}</p>{question && <><h3>我最想问的是</h3><p>{question}</p></>}<small>{email ? `回信邮箱：${email}` : '未填写回信邮箱'}</small><button onClick={() => changePage('write')}>返回修改 ↗</button></section>
                <section className="law-section law-boundary"><h2>提交前的安全提示</h2><ul><li>检查文字中的个人信息，也请保护其他人的隐私。</li><li>匿名不等于绝对无法识别。独特经历、单位、时间地点等细节，也可能暴露身份。</li><li>这是投稿栏目，内容可能经匿名处理后用于公开视频、直播讨论或切片。</li><li>投稿可能由 AI 辅助阅读和整理。请勿无意义刷屏、恶意辱骂或恐吓，共同维护这个免费交流的空间。</li><li>本栏目不提供即时响应。紧急危险或临近的重要期限，请另行及时寻求帮助。</li></ul></section>
                <div className="law-confirm"><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>我已阅读说明并检查隐私信息，了解这是投稿栏目，同意将本次填写内容保存到热线后台，供接收方阅读和处理，知悉投稿可能由 AI 辅助阅读和整理，并在去除可识别信息后，将内容整理、节选或改编用于公开视频及直播讨论。</span></label><button className="law-primary" disabled={!consent || sending || !!receipt} onClick={send}>{receipt ? '已收到投稿' : sending ? '正在保存…' : '确认并提交投稿'} <span>↗</span></button><p role="status" className="law-status">{notice || (submissionUrl ? '确认后发送到热线后台，请勿关闭页面。' : '当前为界面预览，不会真正发送。')}</p></div>
            </>}
        </div>
    </div>;
}
