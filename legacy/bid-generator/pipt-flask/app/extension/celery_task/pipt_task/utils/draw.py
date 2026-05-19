import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from matplotlib.ticker import MaxNLocator


plt.rcParams['font.sans-serif'] = 'SimHei'


def is_null_string(element):
    return '*' in element or element == '无' or element == '无数据'


def remove_asterisk(element):
    if isinstance(element, str):
        if is_null_string(element):
            return None
        else:
            return element
    else:
        return element


def type_A_risk_analyse(type_A_dict, identified_data_read, new_tagging_res, qid_field_dict,
                        exp_type_info_type_mapping_dict, exp_type_ls):
    type_A_info_records_dict = {}
    all_info_types = []
    for type_A_title_index, type_A_df in type_A_dict.items():
        raw_type_A_identified_df = identified_data_read[type_A_title_index]
        type_A_identified_df = raw_type_A_identified_df[raw_type_A_identified_df['sensitive_type'].isin(exp_type_ls)]
        new_tagging_res_slice = new_tagging_res[new_tagging_res['title_index'] == type_A_title_index]
        field_name_info_type_search_dict = dict(
            zip(new_tagging_res_slice['field_name'], new_tagging_res_slice['potential_info_type']))
        # 字段层级的信息类型映射
        exp_fields = new_tagging_res_slice[new_tagging_res_slice['exp_identifier'] == 1]['field_name'].tolist()
        qid_fields = qid_field_dict[type_A_title_index]
        new_type_A_df = type_A_df[qid_fields]
        # 去重
        type_A_df_drop_duplicates = new_type_A_df.drop_duplicates(subset=exp_fields)
        existing_indices = [index for index in type_A_df_drop_duplicates.index if index in type_A_identified_df.index]
        new_type_A_identified_df = type_A_identified_df.loc[existing_indices]

        current_target_info_type_index_search_dict = {}

        # current_row_identified_exp_field_names = type_A_identified_df_row['origin_field_name'].tolist()
        # current_row_identified_exp_info_types = type_A_identified_df_row['sensitive_type'].tolist()
        for target_qid_field in qid_fields:
            target_qid_column_records = type_A_df_drop_duplicates[target_qid_field]
            new_target_qid_column_records = target_qid_column_records.apply(remove_asterisk).dropna()
            target_qid_column_records_index_set = set(new_target_qid_column_records.index)
            target_info_type = field_name_info_type_search_dict[target_qid_field]
            # if target_info_type == '无':
            current_slice = new_type_A_identified_df[new_type_A_identified_df['origin_field_name'] == target_qid_field]

            if target_info_type not in current_target_info_type_index_search_dict.keys():
                current_target_info_type_index_search_dict[target_info_type] = [target_qid_column_records_index_set]
            else:
                current_target_info_type_index_search_dict[target_info_type].append(target_qid_column_records_index_set)

            if not current_slice.empty:
                current_groupped_dict = {}
                grouped = current_slice.groupby('sensitive_type')
                for group_name, group_data in grouped:
                    current_groupped_dict[group_name] = set(group_data.index)
                for target_exp_type in current_groupped_dict.keys():
                    target_exp_info_type = exp_type_info_type_mapping_dict[target_exp_type]
                    if target_exp_info_type not in current_target_info_type_index_search_dict.keys():
                        current_target_info_type_index_search_dict[target_exp_info_type] = [
                            current_groupped_dict[target_exp_type]]
                    else:
                        current_target_info_type_index_search_dict[target_exp_info_type].append(
                            current_groupped_dict[target_exp_type])

        type_A_info_records_dict[type_A_title_index] = {}
        for target_info_type, index_set_list in current_target_info_type_index_search_dict.items():
            target_all_unique_values = {element for s in index_set_list for element in s}
            type_A_info_records_dict[type_A_title_index][target_info_type] = len(target_all_unique_values)
    final_type_A_info_records_dict = {}
    for k, v in type_A_info_records_dict.items():
        for k2, v2 in v.items():
            if k2 == '无':
                continue
            if k2 in final_type_A_info_records_dict.keys():
                num = final_type_A_info_records_dict[k2] + v2
                if num !=0:
                    final_type_A_info_records_dict[k2] = final_type_A_info_records_dict[k2] + v2
            else:
                if v2 !=0:
                    final_type_A_info_records_dict[k2] = v2
    return final_type_A_info_records_dict


def type_C_risk_analyse(type_C_dict, identified_data_read, new_tagging_res, qid_field_dict,
                        exp_type_info_type_mapping_dict, exp_type_ls):
    type_C_info_records_dict = {}
    all_info_types = []
    for type_C_title_index, type_C_df in type_C_dict.items():
        raw_type_C_identified_df = identified_data_read[type_C_title_index]
        type_C_identified_df = raw_type_C_identified_df[raw_type_C_identified_df['sensitive_type'].isin(exp_type_ls)]
        new_tagging_res_slice = new_tagging_res[new_tagging_res['title_index'] == type_C_title_index]
        field_name_info_type_search_dict = dict(
            zip(new_tagging_res_slice['field_name'], new_tagging_res_slice['potential_info_type']))
        # 字段层级的信息类型映射
        qid_fields = qid_field_dict[type_C_title_index]
        new_type_C_df = type_C_df[qid_fields]
        current_target_info_type_index_search_dict = {}

        for target_qid_field in qid_fields:
            target_qid_column_records = new_type_C_df[target_qid_field]
            new_target_qid_column_records = target_qid_column_records.apply(remove_asterisk).dropna()
            target_qid_column_records_index_set = set(new_target_qid_column_records.index)
            target_info_type = field_name_info_type_search_dict[target_qid_field]

            if target_info_type not in current_target_info_type_index_search_dict.keys():
                current_target_info_type_index_search_dict[target_info_type] = [target_qid_column_records_index_set]
            else:
                current_target_info_type_index_search_dict[target_info_type].append(target_qid_column_records_index_set)

        type_C_info_records_dict[type_C_title_index] = {}
        for target_info_type, index_set_list in current_target_info_type_index_search_dict.items():
            target_all_unique_values = {element for s in index_set_list for element in s}
            type_C_info_records_dict[type_C_title_index][target_info_type] = len(target_all_unique_values)

    final_type_C_info_records_dict = {}
    for k, v in type_C_info_records_dict.items():
        for k2, v2 in v.items():
            if k2 == '无':
                continue
            if k2 in final_type_C_info_records_dict.keys():
                num = final_type_C_info_records_dict[k2] + v2
                if num != 0:
                    final_type_C_info_records_dict[k2] = num
            else:
                if v2 !=0:
                    final_type_C_info_records_dict[k2] = v2

    return final_type_C_info_records_dict


def type_A_info_vis(final_type_A_info_records_dict, label_color_mapping, fig_size, bar_width=None):
    target_vis_data = final_type_A_info_records_dict
    target_vis_df = pd.DataFrame(target_vis_data, index=['number']).T.reset_index()

    fa, ax = plt.subplots(figsize=fig_size)
    # sns.barplot(data=target_vis_df, x="index", y="number",edgecolor='black',color=[label_color_mapping[info] for info in target_vis_df['index']])
    for i, label in enumerate(target_vis_df['index']):
        plt.bar(label, target_vis_df['number'][i], width=bar_width, color=label_color_mapping[label], edgecolor='black')
    plt.xticks(rotation=45, fontsize=14)
    plt.yticks(fontsize=14)
    plt.xlabel("披露的个人信息类型", fontsize=16)
    plt.ylabel("涉及人数/人", fontsize=16, labelpad=20)
    plt.title("A类数据集直接披露个人信息涉及人数", fontsize=20)

    for p in ax.patches:
        ax.annotate(f'{int(p.get_height())}', (p.get_x() + p.get_width() / 2., p.get_height()),
                    ha='center', va='bottom', fontsize=15)

    return fa

def type_C_info_vis(final_type_C_info_records_dict, label_color_mapping, fig_size, bar_width=None):
    target_vis_data = final_type_C_info_records_dict
    target_vis_df = pd.DataFrame(target_vis_data, index=['number']).T.reset_index()
    fc, ax = plt.subplots(figsize=fig_size)
    # sns.barplot(data=target_vis_df, x="index", y="number",edgecolor='black',color=[label_color_mapping[info] for info in target_vis_df['index']])
    for i, label in enumerate(target_vis_df['index']):
        plt.bar(label, target_vis_df['number'][i], width=bar_width, color=label_color_mapping[label], edgecolor='black')
    plt.xticks(rotation=45, fontsize=14)
    plt.yticks(fontsize=14)
    plt.xlabel("披露的个人信息类型", fontsize=16)
    plt.ylabel("涉及人数/人", fontsize=16, labelpad=20)
    plt.title("C类数据集间接披露个人信息涉及人数", fontsize=20)

    for p in ax.patches:
        ax.annotate(f'{int(p.get_height())}', (p.get_x() + p.get_width() / 2., p.get_height()),
                    ha='center', va='bottom', fontsize=15)
    return fc


def show_values(axs, orient="v", space=.01, small_value=0, special_value=[None]):
    def _single(ax):
        if orient == "v":
            for p in ax.patches:
                _x = p.get_x() + p.get_width() / 2
                _y = p.get_y() + p.get_height() + space
                value = '{:.0f}'.format(p.get_height())
                # if p.get_height()<=small_value:
                #    continue
                # if p.get_height() in special_value:
                #    continue
                ax.text(_x, _y, value, ha="center", fontsize=12)
        elif orient == "h":
            for p in ax.patches:
                _x = p.get_x() + p.get_width() + float(space)
                _y = p.get_y() + p.get_height() - (p.get_height() * 0.5)
                value = '{:.0f}'.format(p.get_width())
                if p.get_height() <= small_value:
                    continue
                if p.get_height() in special_value:
                    continue
                ax.text(_x, _y, value, ha="left", fontsize=12)

    if isinstance(axs, np.ndarray):
        for idx, ax in np.ndenumerate(axs):
            _single(ax)
    else:
        _single(axs)


def match_res_info_vis(demo_df_explode_groupped):
    g = sns.catplot(
        data=demo_df_explode_groupped, kind="bar",
        x="重标识关联后披露的个人信息类型", y="配对的A类数据集记录行索引", hue="信息类匹配数量",
        palette="bone", edgecolor="black", height=6, aspect=1.5)
    ax = g.facet_axis(0, 0)
    bars = ax.patches

    ax.tick_params(axis="x", direction="in")

    # 调整 y 轴刻度线方向
    ax.tick_params(axis="y", direction="in")

    g.despine(left=True)
    plt.xticks(rotation=45, fontsize=14)
    plt.yticks(fontsize=14)
    g.set_xlabels("披露的个人信息类型", fontsize=16)
    g.set_ylabels("涉及人数/人", fontsize=16, labelpad=20)
    ax1 = g.axes
    show_values(ax1, "v", space=(0.05 / 6) * max(demo_df_explode_groupped['配对的A类数据集记录行索引']), small_value=-1)
    legend = g._legend
    legend.set_title("信息类匹配数量/组", prop={'size': 12})

    sns.move_legend(g, "upper left", bbox_to_anchor=(0.75, 0.9), frameon=True)

    return g


def show_values_spe(axs, orient="v", space=.01, small_value=0, special_value=[None], bin_range=None, bins=None):
    def _single(ax):
        if orient == "v":
            if bin_range:
                f_bin, l_bin = bin_range
                current_bin = f_bin
                for p in ax.patches[f_bin:l_bin]:
                    _x = p.get_x() + p.get_width() / 2
                    _y = p.get_y() + p.get_height() + space
                    bin_index = np.mod(current_bin, bins)
                    value = '{:.0f}'.format(p.get_y() + p.get_height())
                    current_bin += 1
                    ax.text(_x, _y, value, ha="center", fontsize=12)

    if isinstance(axs, np.ndarray):
        for idx, ax in np.ndenumerate(axs):
            _single(ax)
    else:
        _single(axs)


def match_extra_info_vis(demo_groupped, fig_size):
    wdith, height = fig_size
    f, ax = plt.subplots(figsize=fig_size, dpi=300)
    sns.despine(f)
    plt.gca().xaxis.set_major_locator(MaxNLocator(integer=True))

    ax.set_xlabel("关联后标识符信息扩充量/个", fontsize=16, labelpad=10)
    ax.set_ylabel("涉及人数/人", fontsize=16, labelpad=20)

    ax.tick_params(axis="x", direction="in")

    # 调整 y 轴刻度线方向
    ax.tick_params(axis="y", direction="in")
    max_bins = len(range(min(demo_groupped['重标识关联后扩增的标识符信息总数']),
                         max(demo_groupped['重标识关联后扩增的标识符信息总数']))) + 1
    item_num = len(demo_groupped['确信度'].unique())
    sns.histplot(data=demo_groupped, palette='bone', bins=max_bins, x="重标识关联后扩增的标识符信息总数", hue="确信度",
                 multiple="stack")
    for patch in ax.patches:
        patch.set_edgecolor('black')

    legend = ax.get_legend()
    title = legend.get_title()
    title.set_fontsize(14)
    for text in legend.texts:
        text.set_fontsize(12)

    # 计算每个直方柱的宽度
    width = (max(demo_groupped['重标识关联后扩增的标识符信息总数']) - min(
        demo_groupped['重标识关联后扩增的标识符信息总数'])) / (max_bins)

    xlabels = [i for i in range(min(demo_groupped['重标识关联后扩增的标识符信息总数']),
                                max(demo_groupped['重标识关联后扩增的标识符信息总数']) + 1)]
    xticks = []
    for i in range(1, max_bins + 1):
        xticks.append(min(demo_groupped['重标识关联后扩增的标识符信息总数']) + i * width - width / 2)
    heights = []
    rects = ax.patches
    for i, rect in enumerate(rects):
        heights.append(rect.get_height())
        if i == len(range(min(demo_groupped['重标识关联后扩增的标识符信息总数']),
                          max(demo_groupped['重标识关联后扩增的标识符信息总数']))):
            break
    # 将标签放在每个直方柱的中心
    ax.set_xticks(xticks)
    ax.set_xticklabels(xlabels)

    plt.xticks(fontsize=14)
    plt.yticks(fontsize=14)

    show_values_spe(ax, "v", space=(0.1 / height) * max(heights), small_value=-1,
                    bin_range=(max_bins * (item_num - 1), max_bins * item_num), bins=max_bins)

    return f


def publish(type_A_dict, type_C_dict, identified_data_read, new_tagging_res, qid_field_dict,
            exp_type_info_type_mapping_dict, exp_type_ls):
    final_type_A_info_records_dict = type_A_risk_analyse(type_A_dict, identified_data_read, new_tagging_res,
                                                         qid_field_dict, exp_type_info_type_mapping_dict, exp_type_ls)
    final_type_C_info_records_dict = type_C_risk_analyse(type_C_dict, identified_data_read, new_tagging_res,
                                                         qid_field_dict, exp_type_info_type_mapping_dict, exp_type_ls)

    all_info_types = list(
        set(list(final_type_A_info_records_dict.keys()) + list(final_type_C_info_records_dict.keys())))

    colors = sns.color_palette("RdYlBu", n_colors=len(all_info_types))
    alpha = 0.9  # 设置alpha值
    fig_size = (12, 8)
    colors_with_alpha = [(r * 0.9, g * 0.9, b * 0.9, alpha) for (r, g, b) in colors]
    label_color_mapping = dict(zip(all_info_types, colors_with_alpha))
    fa = type_A_info_vis(final_type_A_info_records_dict, label_color_mapping, fig_size, bar_width=0.5)
    fc = type_C_info_vis(final_type_C_info_records_dict, label_color_mapping, fig_size, bar_width=0.5)
    return final_type_A_info_records_dict,final_type_C_info_records_dict,fa, fc


def match_res_inf(demo_df):
    demo_df_process = demo_df.copy()
    demo_df_process['重标识关联后披露的个人信息类型'] = [i.split(';') for i in
                                                         demo_df_process['重标识关联后披露的个人信息类型']]
    demo_df_explode = demo_df_process.explode('重标识关联后披露的个人信息类型')
    demo_df_explode['信息类匹配数量'] = (demo_df_explode['当前记录行配对下的可靠性评估维度指标'] + demo_df_explode[
        '配对的准标识符信息数量'])
    #demo_df_explode['信息类匹配数量'] = demo_df_explode['当前记录行配对下的可靠性评估维度指标'] / demo_df_explode['当前数据集配对下的最高可靠性评估维度指标']
    demo_df_explode_groupped = demo_df_explode.groupby(
        ['配对的A类数据集', '配对的C类数据集', '重标识关联后披露的个人信息类型', '信息类匹配数量']
    )[['配对的A类数据集记录行索引']].count().reset_index()
    return match_res_info_vis(demo_df_explode_groupped)


def match_extra_info(demo_df):
    fig_size = (12, 9)
    demo_groupped = demo_df.groupby(
        ['配对的A类数据集', '配对的C类数据集', '配对的A类数据集记录行索引', '重标识关联后扩增的标识符信息总数'])[
        '配对的C类数据集记录行索引'].count().reset_index()
    demo_groupped['确信度'] = (1 / demo_groupped['配对的C类数据集记录行索引']).round(2)
    return match_extra_info_vis(demo_groupped, fig_size)

def evaluation_draw(type_A_dict, type_C_dict, identified_data_read, new_tagging_res, qid_field_dict):

    exp_type_ls = ['name', 'phone', 'id_number', 'bank', 'car', 'email', 'ip']
    info_type_ls = ['个人基本信息', '个人基本信息', '个人基本信息', '个人身份信息', '个人财产信息', '个人基本信息', '个人设备信息']
    exp_type_info_type_mapping_dict = dict(zip(exp_type_ls, info_type_ls))

    fad,fcd,fa, fc = publish(type_A_dict, type_C_dict, identified_data_read, new_tagging_res, qid_field_dict, exp_type_info_type_mapping_dict, exp_type_ls)


    return fad,fcd,fa, fc

def reid_draw(demo_df, type_A_dict, type_C_dict, identified_data_read, new_tagging_res, qid_field_dict):

    exp_type_ls = ['name', 'phone', 'ID', 'bank', 'car', 'email', 'ip']
    info_type_ls = ['个人基本信息', '个人基本信息', '个人基本信息', '个人身份信息', '个人财产信息', '个人基本信息', '个人设备信息']
    exp_type_info_type_mapping_dict = dict(zip(exp_type_ls, info_type_ls))

    #fa, fc = publish(type_A_dict, type_C_dict, identified_data_read, new_tagging_res, qid_field_dict, exp_type_info_type_mapping_dict, exp_type_ls)
    g = match_res_inf(demo_df)
    fm = match_extra_info(demo_df)

    #return fa, fc, g, fm
    return g, fm

